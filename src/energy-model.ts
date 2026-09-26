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
    /** Motor energy over motor + rider energy on those rides, when measured. */
    motorShare: number | null;
}

/* Outside this window the measured motor share says more about the file than
   about the riding: the Tuner then anchors on the DJI stock mix instead. */
export const MOTOR_SHARE_MIN = 0.2;
export const MOTOR_SHARE_MAX = 0.98;

export function motorShareMeasured(value: unknown): number | null {
    const n = parseFloat(String(value));
    return n >= MOTOR_SHARE_MIN && n <= MOTOR_SHARE_MAX ? n : null;
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

/* Moving speed. On the flat it barely depends on the mode; on a climb it
   follows the total power (rider + motor). Two recorded rides fix the
   relation: at the same gradient the rider eased off as the assist grew
   (142 W at 1.2x, 96 W at 3x), so the total power grew only with the cube
   root of (1 + assist ratio), from twice the rider's average pedalling
   power. With a 10% climb and offroad rolling resistance this reproduces
   the measured 8.5 km/h (1.2x) and 10.3 km/h (3x) climbing speeds. */
export const FLAT_SPEED_KMH = 15;
export const CLIMB_GRADE = 0.10;
export const CLIMB_ROLLING_RESISTANCE = 0.03;
export const CLIMB_EFFORT = 2.0;
const GRAVITY = 9.81;

export function climbTotalPowerW(riderW: number, motorW: number): number {
    return CLIMB_EFFORT * riderW * Math.cbrt(1 + motorW / riderW);
}

export function climbSpeedKmH(riderW: number, motorW: number, totalWeight: number): number {
    return 3.6 * climbTotalPowerW(riderW, motorW) / (totalWeight * GRAVITY * (CLIMB_GRADE + CLIMB_ROLLING_RESISTANCE));
}

/** Average moving speed on ground climbing `climbMPerKm`, ridden at CLIMB_GRADE. */
export function movingSpeedKmH(climbMPerKm: number, riderW: number, motorW: number, totalWeight: number): number {
    const climbing = clamp(climbMPerKm / (1000 * CLIMB_GRADE), 0, 0.9);
    const vClimb = climbSpeedKmH(riderW, motorW, totalWeight);
    return 1 / (climbing / vClimb + (1 - climbing) / FLAT_SPEED_KMH);
}

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
    speedKmH: number;
}

/**
 * Without a calibration: the route model on the reference ground, anchored on
 * the DJI stock modes in the mix the route model assigns to that ground.
 * With one: the ground of the calibration rides, anchored on the motor share
 * measured on them. The rides were ridden in the rider's own modes, not in a
 * stock mix, so each mode takes the measured consumption scaled by its motor
 * share over the rides' motor share (the total energy per km depends on the
 * ground, not on the mode: checked on two real rides).
 */
export function tunerRanges(i: TunerRangeInput) {
    const personal = personalFactorOf(i.real, i.totalWeight);
    const calibrated = personal.applied && i.real != null;
    const ground = calibrated
        ? { climbMPerKm: i.real!.hm / i.real!.km, surfaceId: i.real!.surfaceId, steepShare: i.real!.steepShare }
        : { climbMPerKm: REFERENCE_CLIMB_M_PER_KM, surfaceId: REFERENCE_SURFACE, steepShare: 0 };
    const terrain = terrainEnergy({ km: 1, hm: ground.climbMPerKm, totalWeight: i.totalWeight, ...ground });
    const mix = modeMixFor(terrain.climb / terrain.base);
    const referenceWhPerKm = terrain.estimated * personal.factor;

    const ridesShare = calibrated ? i.real!.motorShare : null;
    const stockShare = MODE_KEYS.reduce((sum, k) => sum + mix[k] * motorShareOf(i.stockMotorW[k], i.riderW), 0);
    const anchorShare = ridesShare ?? stockShare;

    const rangeOf = (motorW: number): ModeRange => {
        const whPerKm = anchorShare > 0 ? referenceWhPerKm * motorShareOf(motorW, i.riderW) / anchorShare : 0;
        if (!(whPerKm > 0)) return { whPerKm: 0, range: 0, runtime: 0, speedKmH: 0 };
        const range = i.batteryWh / whPerKm;
        const speed = movingSpeedKmH(ground.climbMPerKm, i.riderW, motorW, i.totalWeight);
        return {
            whPerKm: Math.round(whPerKm * 10) / 10,
            range: Math.round(range),
            runtime: Math.round((range / speed) * 10) / 10,
            speedKmH: Math.round(speed * 10) / 10
        };
    };

    const perMode = (w: Record<ModeKey, number>) =>
        Object.fromEntries(MODE_KEYS.map((k) => [k, rangeOf(w[k])])) as Record<ModeKey, ModeRange>;

    return {
        referenceWhPerKm,
        ground: { ...ground, basis: calibrated ? 'rides' : 'reference' },
        anchor: ridesShare != null ? 'rides' : 'stock',
        mix,
        personal,
        modes: perMode(i.modeMotorW),
        stock: perMode(i.stockMotorW)
    };
}
