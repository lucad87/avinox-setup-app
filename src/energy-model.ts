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
