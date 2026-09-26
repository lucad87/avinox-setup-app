/* ==================================================================
 * ROUTE ENERGY MODEL
 * ------------------------------------------------------------------
 * One model for every endpoint that judges a route against the battery,
 * so the feasibility verdict and the proposed modes can never disagree.
 *
 * Every figure here is PACK energy: the Wh taken out of the battery. A
 * recording measures MOTOR energy (mechanical output), so a measurement is
 * converted with the pack efficiency before it is compared with the model.
 * ================================================================== */

export const SURFACE_FACTORS: Record<string, number> = {
    road: 1.00,
    gravel: 1.12,
    mixed: 1.22,
    technical: 1.35
};
export const DEFAULT_SURFACE = 'mixed';

// Steep ground is less efficient: more torque, lower cadence, more heat.
export const STEEP_ENERGY_PENALTY = 0.35;

export const QUALITY_MARGIN: Record<string, number> = {
    good: 0.12,
    noisy: 0.22,
    unavailable: 0.30
};

export const GRADE_KEYS = ['descent', 'flat', 'rolling', 'climb', 'steep', 'extreme'];

/* Baseline pack consumption: flat riding per km, and climbing per metre of
   gain for every 100 kg of system weight. The climbing figure sits below the
   raw potential energy (0.27 Wh per m per 100 kg) because the rider supplies
   part of the work. */
export const FLAT_WH_PER_KM = 3.8;
export const CLIMB_WH_PER_M_PER_100KG = 0.24;

/* Motor energy vs energy taken from the pack. The client measures it on the
   battery drop of the rides when it can; outside this window the measurement
   says more about the data (a range extender, the wrong pack selected) than
   about the drive, and the default is used instead. */
export const PACK_EFFICIENCY_DEFAULT = 0.8;
export const PACK_EFFICIENCY_MIN = 0.6;
export const PACK_EFFICIENCY_MAX = 0.95;

/* A personal factor only makes sense inside a sane window. Outside it the
   model and the bike disagree by a large multiple, which is a measurement
   artefact (the motor was off for most of the ride, or the file's power field
   reads differently) rather than a riding style. A rejected measurement is
   never applied silently: the response says why. */
export const PLAUSIBLE_FACTOR_MIN = 0.5;
export const PLAUSIBLE_FACTOR_MAX = 1.5;
export const PLAUSIBLE_WH_PER_KM_MIN = 2.5;

export const DEFAULT_RESERVE_PERCENT = 15;
export const MAX_RESERVE_PERCENT = 50;

export function clamp(value: number, min: number, max: number): number {
    if (min > max) return max;
    return Math.min(Math.max(value, min), max);
}

/** Keeps only the known grade bands; returns null when nothing usable. */
export function normaliseDistribution(value: unknown): Record<string, number> | null {
    if (!value || typeof value !== 'object') return null;
    const source = value as Record<string, unknown>;
    const out: Record<string, number> = {};
    let any = false;

    for (const key of GRADE_KEYS) {
        const n = parseFloat(String(source[key]));
        out[key] = Number.isFinite(n) && n >= 0 ? n : 0;
        if (out[key] > 0) any = true;
    }
    return any ? out : null;
}

export function surfaceIdOf(value: unknown): string {
    const id = String(value);
    return SURFACE_FACTORS[id] ? id : DEFAULT_SURFACE;
}

/** Share of the distance in the steep and extreme bands, 0..1. */
export function steepShareOf(distribution: Record<string, number> | null): number {
    if (!distribution) return 0;
    return clamp((distribution.steep + distribution.extreme) / 100, 0, 1);
}

export function steepnessFactorOf(steepShare: number): number {
    return 1 + STEEP_ENERGY_PENALTY * clamp(steepShare, 0, 1);
}

export function packEfficiencyOf(value: unknown): number {
    const n = parseFloat(String(value));
    return n >= PACK_EFFICIENCY_MIN && n <= PACK_EFFICIENCY_MAX ? n : PACK_EFFICIENCY_DEFAULT;
}

export function reservePercentOf(value: unknown): number {
    const n = parseFloat(String(value));
    return Number.isFinite(n) && n >= 0 ? clamp(n, 0, MAX_RESERVE_PERCENT) : DEFAULT_RESERVE_PERCENT;
}

export function implausibleReason(motorWhPerKm: number, factor: number | null): string | null {
    if (!(motorWhPerKm >= PLAUSIBLE_WH_PER_KM_MIN)) return 'consumption-too-low';
    if (factor != null && (factor < PLAUSIBLE_FACTOR_MIN || factor > PLAUSIBLE_FACTOR_MAX)) {
        return 'factor-out-of-range';
    }
    return null;
}

export interface Terrain {
    km: number;
    hm: number;
    totalWeight: number;
    surfaceId: string;
    steepShare: number;
}

export function terrainEnergy(t: Terrain) {
    const flat = t.km * FLAT_WH_PER_KM;
    const climb = t.hm * CLIMB_WH_PER_M_PER_100KG * (t.totalWeight / 100);
    const base = flat + climb;
    const surfaceFactor = SURFACE_FACTORS[surfaceIdOf(t.surfaceId)];
    const steepnessFactor = steepnessFactorOf(t.steepShare);
    return { flat, climb, base, surfaceFactor, steepnessFactor, estimated: base * surfaceFactor * steepnessFactor };
}

/** Rides the consumption was measured on, described like a route. */
export interface MeasuredRides {
    motorWhPerKm: number;
    km: number;
    hm: number;
    efficiency: number;
    surfaceId: string;
    steepShare: number;
}

export interface PersonalFactor {
    factor: number;
    raw: number | null;
    rejected: string | null;
    applied: boolean;
    packWhPerKm: number | null;
}

/**
 * Measured pack consumption over what the model predicts for the SAME rides,
 * with the same surface and steepness assumptions the route estimate applies.
 * Comparing against the bare baseline would leave the surface inside the
 * factor, and the route estimate would then apply it a second time.
 */
export function personalFactorOf(real: MeasuredRides | null, totalWeight: number): PersonalFactor {
    const none: PersonalFactor = { factor: 1, raw: null, rejected: null, applied: false, packWhPerKm: null };
    if (!real || !(real.motorWhPerKm > 0) || !(real.km > 1)) return none;

    const packWhPerKm = real.motorWhPerKm / real.efficiency;
    const model = terrainEnergy({ ...real, totalWeight });
    const modelWhPerKm = model.estimated / real.km;
    if (!(modelWhPerKm > 0.5)) return { ...none, packWhPerKm };

    const raw = packWhPerKm / modelWhPerKm;
    const rejected = implausibleReason(real.motorWhPerKm, raw);
    return { factor: rejected ? 1 : raw, raw, rejected, applied: !rejected, packWhPerKm };
}

export interface RouteEnergyInput extends Terrain {
    batteryWh: number;
    reservePercent: number;
    elevationQuality: string | null;
    real: MeasuredRides | null;
}

export function estimateRouteEnergy(i: RouteEnergyInput) {
    const terrain = terrainEnergy(i);
    const personal = personalFactorOf(i.real, i.totalWeight);
    const estimated = terrain.estimated * personal.factor;

    const margin = QUALITY_MARGIN[String(i.elevationQuality)] ?? QUALITY_MARGIN.noisy;
    const reserveWh = (i.batteryWh * i.reservePercent) / 100;
    const usableWh = i.batteryWh - reserveWh;
    const required = Math.round(estimated);
    const feasible = required <= usableWh;

    return {
        ...terrain,
        estimated,
        required,
        low: estimated * (1 - margin),
        high: estimated * (1 + margin),
        margin,
        confidence: i.elevationQuality === 'good' ? 'medium' : 'low',
        personal,
        reserveWh,
        usableWh,
        feasible,
        scalingFactor: feasible || required <= 0 ? 1 : usableWh / required
    };
}

/* ==================================================================
 * TUNER RANGES
 * ------------------------------------------------------------------
 * The Tuner's range and runtime come from the same model as the route, on
 * a reference terrain, so the two tabs quote the same Wh/km for the same
 * ground. The route model describes riding with the DJI stock modes in the
 * mix it assigns to that terrain; each mode then takes its part of the work
 * by its motor share (motor / (motor + rider) at the rider's input): the
 * terrain decides how much energy a kilometre needs, the assist decides who
 * supplies it.
 * ================================================================== */

export type ModeKey = 'eco' | 'auto' | 'trail' | 'turbo';
export const MODE_KEYS: ModeKey[] = ['eco', 'auto', 'trail', 'turbo'];

export const REFERENCE_CLIMB_M_PER_KM = 15;
export const REFERENCE_SURFACE = 'mixed';
// One moving average for every mode: the terrain is the same, and a duration
// per mode then reads as "how long the battery lasts" rather than as a pace.
export const REFERENCE_SPEED_KMH = 16;

/** Share of the distance ridden in each mode, from the climbing share of the energy (0..1). */
export function modeMixFor(climbRatio: number): Record<ModeKey, number> {
    const c = clamp(climbRatio, 0, 1);
    const f = 1 - c;
    return {
        eco: 0.40 * f + 0.15 * c,
        auto: 0.50 * f + 0.45 * c,
        trail: 0.10 * f + 0.32 * c,
        turbo: 0.00 * f + 0.08 * c
    };
}

export function motorShareOf(motorW: number, riderW: number): number {
    return motorW > 0 && riderW > 0 ? motorW / (motorW + riderW) : 0;
}

export interface TunerRangeInput {
    totalWeight: number;
    batteryWh: number;
    riderW: number;
    modeMotorW: Record<ModeKey, number>;
    stockMotorW: Record<ModeKey, number>;
    real: MeasuredRides | null;
}

export interface ModeRange {
    whPerKm: number;
    range: number;
    runtime: number;
}

export function tunerRanges(i: TunerRangeInput) {
    const terrain = terrainEnergy({
        km: 1,
        hm: REFERENCE_CLIMB_M_PER_KM,
        totalWeight: i.totalWeight,
        surfaceId: REFERENCE_SURFACE,
        steepShare: 0
    });
    const mix = modeMixFor(terrain.climb / terrain.base);
    const personal = personalFactorOf(i.real, i.totalWeight);
    const referenceWhPerKm = terrain.estimated * personal.factor;
    const stockShare = MODE_KEYS.reduce((sum, k) => sum + mix[k] * motorShareOf(i.stockMotorW[k], i.riderW), 0);

    const rangeOf = (motorW: number): ModeRange => {
        const whPerKm = stockShare > 0 ? referenceWhPerKm * motorShareOf(motorW, i.riderW) / stockShare : 0;
        if (!(whPerKm > 0)) return { whPerKm: 0, range: 0, runtime: 0 };
        const range = i.batteryWh / whPerKm;
        return {
            whPerKm: Math.round(whPerKm * 10) / 10,
            range: Math.round(range),
            runtime: Math.round((range / REFERENCE_SPEED_KMH) * 10) / 10
        };
    };

    const perMode = (w: Record<ModeKey, number>) =>
        Object.fromEntries(MODE_KEYS.map((k) => [k, rangeOf(w[k])])) as Record<ModeKey, ModeRange>;

    return { referenceWhPerKm, mix, personal, modes: perMode(i.modeMotorW), stock: perMode(i.stockMotorW) };
}
