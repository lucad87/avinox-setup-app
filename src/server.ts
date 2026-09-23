import express, { Request, Response } from 'express';
import path from 'path';

const app = express();
const port = 3080;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

/* ==================================================================
 * AVINOX ASSIST MODEL — M2 / M2S ONLY
 * ------------------------------------------------------------------
 * Sources:
 *  - Avinox Drive System User Manual (edition 2026.04)
 *  - Avinox Ride app (AvinoxRide)
 *  - Community real-world settings (EMTB Forums "Avinox Motor Tuning")
 *
 * Assist level semantics (verified against the app):
 *  - ECO   : FIXED single level
 *  - TURBO : FIXED single level
 *  - AUTO  : min-max RANGE
 *  - TRAIL : min-max RANGE
 *  - Extra custom modes added from the app also use a FIXED level.
 * ================================================================== */

/* --------------------------- 1. HARDWARE --------------------------- */
/* M1 is intentionally not supported. M2S is the default.               */

interface BikeSpec {
    id: string;
    name: string;
    maxTorque: number;            // Nm, continuous
    maxPower: number;             // W, continuous
    boostTorque: number;          // Nm in Boost
    boostPower: number;           // W in Boost
    boostDurationDefault: number; // s
    note?: string;
}

const BIKES: Record<string, BikeSpec> = {
    M2S: {
        id: 'M2S',
        name: 'Avinox M2S',
        maxTorque: 130,
        maxPower: 1300,
        boostTorque: 150,
        boostPower: 1500,
        boostDurationDefault: 30,
        note: 'Boost 150 Nm / 1500 W requires the 700 Wh battery; with other batteries peak output is lower.'
    },
    M2: {
        id: 'M2',
        name: 'Avinox M2',
        maxTorque: 110,
        maxPower: 1100,
        boostTorque: 125,
        boostPower: 1100,
        boostDurationDefault: 30,
        note: 'Up to 1100 W and 125 Nm it behaves like the M2S.'
    }
};

const DEFAULT_BIKE = 'M2S';
const BOOST_DURATION_MIN = 1;
const BOOST_DURATION_MAX = 60;

/* ------------------- ENTRY GRID (Avinox Ride app) ------------------ */
/* The app does not accept arbitrary numbers: Max Power and Max Torque  */
/* are stepped. Real-world community setups use torque 50/75/85/105 Nm  */
/* and power 400/500/600/700/750/850/1000 W — all multiples of 5 Nm and */
/* 50 W. Snapping to these grids therefore always yields an enterable   */
/* value, while a finer grid (10 Nm / 100 W) would not.                 */
const TORQUE_STEP_NM = 5;
const POWER_STEP_W = 50;

/* ------------------- ROUTE ENERGY MODEL (Phase 2) ------------------ */
/* The flat/climb baseline is unchanged so figures stay comparable with    */
/* earlier estimates. On top of it the route analysis applies two          */
/* documented corrections, and reports an interval instead of a single     */
/* number, because wind, temperature, tyres and riding style are unknown.  */

const SURFACE_FACTORS: Record<string, number> = {
    road: 1.00,
    gravel: 1.12,
    mixed: 1.22,
    technical: 1.35
};

// Steep ground is less efficient: more torque, lower cadence, more heat.
const STEEP_ENERGY_PENALTY = 0.35;

const QUALITY_MARGIN: Record<string, number> = {
    good: 0.12,
    noisy: 0.22,
    unavailable: 0.30
};

const GRADE_KEYS = ['descent', 'flat', 'rolling', 'climb', 'steep', 'extreme'];

/** Keeps only the known grade bands; returns null when nothing usable. */
function normaliseDistribution(value: unknown): Record<string, number> | null {
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

/* ------------------------ 2. ASSIST LEVELS ------------------------- */
/* Motor-to-rider support ratios per level, as % of rider input.        */
/* SOURCE: community-confirmed mapping for the M2S (multiple independent */
/* users agree on the full curve; anchor levels 3=100%, 4=150%, 8=300%,  */
/* 13=700% are the most cited). The DJI app does not display these %, so */
/* this remains community data, not an official DJI specification.       */
/* Previous project calibration kept for reference:                      */
/*   0.30, 0.60, 0.80, 1.00, 1.25, 1.50, 1.75, 2.25, 3.00, 3.75,         */
/*   4.45, 5.25, 6.75, 8.25, 9.50                                        */

const ASSIST_LEVELS: Array<{ level: number; ratio: number }> = [
    { level: 1, ratio: 0.35 },
    { level: 2, ratio: 0.70 },
    { level: 3, ratio: 1.00 },
    { level: 4, ratio: 1.50 },
    { level: 5, ratio: 1.85 },
    { level: 6, ratio: 2.15 },
    { level: 7, ratio: 2.45 },
    { level: 8, ratio: 3.00 },
    { level: 9, ratio: 3.60 },
    { level: 10, ratio: 4.35 },
    { level: 11, ratio: 5.15 },
    { level: 12, ratio: 6.05 },
    { level: 13, ratio: 7.00 },
    { level: 14, ratio: 7.65 },
    { level: 15, ratio: 8.00 }
];

function ratioOfLevel(level: number): number {
    const found = ASSIST_LEVELS.find((a) => a.level === level);
    return found ? found.ratio : 0;
}

/** Human-readable % of rider input for a level, e.g. "360%". */
function pctOfLevel(level: number): string {
    return `${Math.round(ratioOfLevel(level) * 100)}%`;
}

/**
 * Picks the assist level for a target ratio inside an allowed band: the
 * smallest ratio >= target.
 *
 * FIX: if the target exceeds every ratio in the band, this now returns the
 * band CEILING. The previous implementation left `bestLevel` at its initial
 * value (`minLvl`), so an out-of-band request collapsed to the weakest
 * level instead of the strongest — which then produced inverted ranges.
 */
function findNearestAssistLevel(targetRatio: number, minLvl: number, maxLvl: number): number {
    const band = ASSIST_LEVELS.filter((al) => al.level >= minLvl && al.level <= maxLvl);
    if (band.length === 0) return minLvl;

    let bestLevel = band[0].level;
    let bestDiff = Infinity;

    for (const al of band) {
        const diff = al.ratio - targetRatio;
        if (diff >= 0 && diff < bestDiff) {
            bestDiff = diff;
            bestLevel = al.level;
        }
    }

    if (bestDiff === Infinity) return band[band.length - 1].level;
    return bestLevel;
}

/* ---------------------------- 3. MODES ----------------------------- */

type ModeKey = 'eco' | 'auto' | 'trail' | 'turbo';

interface ModeBlueprint {
    key: ModeKey;
    label: string;
    type: 'static' | 'range';
    defaultWkg: number;
    floorWkg?: number;
    // Level bands are PROJECT CALIBRATION, not an Avinox specification.
    band: [number, number];
    minPower: number;
    // Dynamic parameter defaults, taken from real-world community settings.
    overrun: number;
    start: number;
    continued: number;
    accel: number | null;
    desc: string;
}

const MODES: ModeBlueprint[] = [
    {
        key: 'eco', label: 'ECO', type: 'static', defaultWkg: 1.36, band: [1, 7], minPower: 100,
        overrun: 1, start: 3, continued: 3, accel: null,
        desc: 'Maximum range. Fixed level, soft power delivery.'
    },
    {
        key: 'auto', label: 'AUTO', type: 'range', defaultWkg: 2.73, floorWkg: 1.80, band: [3, 11], minPower: 200,
        overrun: 2, start: 5, continued: 5, accel: 3,
        desc: 'Dynamic range: reacts to gradient. The only mode with Max Acceleration.'
    },
    {
        key: 'trail', label: 'TRAIL', type: 'range', defaultWkg: 5.45, floorWkg: 3.60, band: [6, 13], minPower: 300,
        overrun: 2, start: 5, continued: 3, accel: null,
        desc: 'Reference mode: wide range, technical support on climbs.'
    },
    {
        key: 'turbo', label: 'TURBO', type: 'static', defaultWkg: 7.72, band: [8, 15], minPower: 400,
        overrun: 3, start: 5, continued: 3, accel: null,
        desc: 'Maximum output. Fixed level, high consumption.'
    }
];

/* ---------------------------- UTILITIES ---------------------------- */

function clamp(value: number, min: number, max: number): number {
    if (min > max) return max;
    return Math.min(Math.max(value, min), max);
}

/**
 * Snaps a value to the step grid the Avinox app accepts, keeping it inside
 * [min, max]. Both bounds must themselves sit on the grid.
 */
function snapToGrid(value: number, step: number, min: number, max: number): number {
    const clamped = Math.min(Math.max(value, min), max);
    return Math.min(Math.max(Math.round(clamped / step) * step, min), max);
}

function round(value: number): number {
    return Math.round(value);
}

function pickBike(value: unknown): BikeSpec {
    return BIKES[String(value)] ?? BIKES[DEFAULT_BIKE];
}

function pickNumber(value: unknown, fallback: number): number {
    const n = parseFloat(String(value));
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Estimated range/runtime model (unchanged): runtime = battery / motor power,
// range = runtime x an assumed average speed per mode.
function calculateMetrics(watts: number, speedKmH: number, batteryWh: number) {
    const runtimeHours = batteryWh / watts;
    const rangeKm = runtimeHours * speedKmH;
    return {
        runtime: parseFloat(runtimeHours.toFixed(1)),
        range: parseFloat(rangeKm.toFixed(0))
    };
}

interface ModeResult {
    key: ModeKey;
    label: string;
    type: 'static' | 'range';
    desc: string;
    level: string;
    levelPct: string;
    assistMin: number;
    assistMax: number;
    watts: string;
    torque: string;
    wkg: string;
    maxPower: number;
    typicalPower: number;
    maxTorque: number;
    idealPower: number;
    idealTorque: number;
    maxOverrun: number;
    assistStart: number;
    continuedAssist: number;
    maxAccel: number | null;
    amplification: number;
    range: number;
    runtime: number;
    achievable: boolean;
    warnings: string[];
}

function buildMode(
    bp: ModeBlueprint,
    assistMin: number,
    assistMax: number,
    targetPower: number,
    pRider: number,
    bike: BikeSpec,
    rpm: number,
    totalWeight: number,
    speedKmH: number,
    batteryWh: number
): ModeResult {
    const warnings: string[] = [];

    // Snap the power ceiling to the grid the Avinox app actually accepts.
    const idealPower = clamp(round(targetPower), bp.minPower, bike.maxPower);
    const maxPower = snapToGrid(idealPower, POWER_STEP_W, bp.minPower, bike.maxPower);

    // Torque required to deliver that power at the chosen cadence, snapped too.
    const idealTorque = (maxPower * 9.55) / rpm;
    const maxTorque = snapToGrid(round(idealTorque), TORQUE_STEP_NM, TORQUE_STEP_NM, bike.maxTorque);
    const achievable = idealTorque <= bike.maxTorque + 0.5;

    if (!achievable) {
        const rpmNeeded = Math.ceil((maxPower * 9.55) / bike.maxTorque);
        warnings.push(
            `Needs ${round(idealTorque)} Nm at ${round(rpm)} RPM but the motor stops at ${bike.maxTorque} Nm: ` +
            `the real ceiling is ~${Math.round((bike.maxTorque * rpm) / 9.55)} W. At least ${rpmNeeded} RPM are required.`
        );
    }

    // Expected draw at the rider's typical input: the level's amplification
    // times the rider power, bounded by the configured Max Power and by the
    // physical torque ceiling at the chosen cadence (P = T x rpm / 9.55).
    // Runtime and range use this expected draw instead of assuming the motor
    // rides at Max Power continuously.
    const torqueCeiling = (bike.maxTorque * rpm) / 9.55;
    const levelDraw = ratioOfLevel(assistMax) * pRider;
    const typicalPower = Math.round(Math.min(maxPower, torqueCeiling, levelDraw));

    const metrics = calculateMetrics(typicalPower, speedKmH, batteryWh);

    return {
        key: bp.key,
        label: bp.label,
        type: bp.type,
        desc: bp.desc,
        level: assistMin === assistMax ? `Level ${assistMin}` : `Level ${assistMin} - ${assistMax}`,
        levelPct: assistMin === assistMax
            ? pctOfLevel(assistMin)
            : `${pctOfLevel(assistMin)} – ${pctOfLevel(assistMax)}`,
        assistMin,
        assistMax,
        watts: `${maxPower} W`,
        torque: `${maxTorque} Nm`,
        wkg: (maxPower / totalWeight).toFixed(2),
        maxPower,
        typicalPower,
        maxTorque,
        idealPower,
        idealTorque: round(idealTorque),
        maxOverrun: bp.overrun,
        assistStart: bp.start,
        continuedAssist: bp.continued,
        maxAccel: bp.accel,
        amplification: pRider > 0 ? Math.round((maxPower / pRider) * 100) / 100 : 0,
        range: metrics.range,
        runtime: metrics.runtime,
        achievable,
        warnings
    };
}

/* ------------------------------- API ------------------------------- */

app.post('/api/calculate', (req: Request, res: Response) => {
    const body = req.body ?? {};

    const riderWeight = parseFloat(body.riderWeight);
    const bikeWeight = parseFloat(body.bikeWeight);
    const rpm = parseFloat(body.cadence);
    const pRider = parseFloat(body.riderPower);

    if (![riderWeight, bikeWeight, rpm, pRider].every((n) => Number.isFinite(n) && n > 0)) {
        return res.status(400).json({
            error: 'Invalid parameters: rider weight, bike weight, cadence and rider power must be positive numbers.'
        });
    }
    if (rpm < 20 || rpm > 140) {
        return res.status(400).json({ error: 'Cadence outside the plausible range (20-140 RPM).' });
    }

    const bike = pickBike(body.bike);
    const batteryWh = pickNumber(body.batteryWh, 800);

    // Boost duration: user adjustable, default 30 s, clamped to 1-60 s.
    const boostDuration = clamp(
        round(pickNumber(body.boostDuration, bike.boostDurationDefault)),
        BOOST_DURATION_MIN,
        BOOST_DURATION_MAX
    );

    const totalWeight = riderWeight + bikeWeight;
    const globalWarnings: string[] = [];

    // Physical power ceiling at the chosen cadence: P = T * rpm / 9.55
    const maxPowerAtCadence = Math.round((bike.maxTorque * rpm) / 9.55);

    const byKey: Record<string, ModeResult> = {};
    const targetWkg: Record<ModeKey, number> = {
        eco: pickNumber(body.ecoWkg, MODES[0].defaultWkg),
        auto: pickNumber(body.autoWkg, MODES[1].defaultWkg),
        trail: pickNumber(body.trailWkg, MODES[2].defaultWkg),
        turbo: pickNumber(body.turboWkg, MODES[3].defaultWkg)
    };

    const blueprint = (key: ModeKey): ModeBlueprint => MODES.find((m) => m.key === key)!;

    // --- Step 1: ECO (static, fixed level) ---------------------------
    const ecoBp = blueprint('eco');
    const ecoPower = clamp(round(totalWeight * targetWkg.eco), ecoBp.minPower, bike.maxPower);
    const ecoLevel = findNearestAssistLevel(ecoPower / pRider, ecoBp.band[0], ecoBp.band[1]);
    byKey.eco = buildMode(ecoBp, ecoLevel, ecoLevel, ecoPower, pRider, bike, rpm, totalWeight, 22, batteryWh);

    // --- Step 2: AUTO (range), floor anchored above ECO --------------
    const autoBp = blueprint('auto');
    const autoPower = clamp(round(totalWeight * targetWkg.auto), autoBp.minPower, bike.maxPower);
    const autoFloorPower = clamp(
        round(totalWeight * (autoBp.floorWkg ?? autoBp.defaultWkg)),
        autoBp.minPower,
        autoPower
    );
    const autoMax = findNearestAssistLevel(autoPower / pRider, autoBp.band[0], autoBp.band[1]);
    // FIX: the floor is clamped against the ceiling, so min can never exceed max.
    const autoMin = clamp(
        Math.max(findNearestAssistLevel(autoFloorPower / pRider, autoBp.band[0], autoBp.band[1]), ecoLevel + 1),
        autoBp.band[0],
        autoMax
    );
    byKey.auto = buildMode(autoBp, autoMin, autoMax, autoPower, pRider, bike, rpm, totalWeight, 18, batteryWh);

    // --- Step 3: TRAIL (range), floor anchored above AUTO ------------
    const trailBp = blueprint('trail');
    const trailPower = clamp(round(totalWeight * targetWkg.trail), trailBp.minPower, bike.maxPower);
    const trailFloorPower = clamp(
        round(totalWeight * (trailBp.floorWkg ?? trailBp.defaultWkg)),
        trailBp.minPower,
        trailPower
    );
    const trailMax = findNearestAssistLevel(trailPower / pRider, trailBp.band[0], trailBp.band[1]);
    // FIX: the floor is clamped against the TRAIL ceiling, not merely copied
    // from AUTO, so an inverted "min > max" range is impossible.
    const trailMin = clamp(
        Math.max(findNearestAssistLevel(trailFloorPower / pRider, trailBp.band[0], trailBp.band[1]), autoMax),
        trailBp.band[0],
        trailMax
    );
    byKey.trail = buildMode(trailBp, trailMin, trailMax, trailPower, pRider, bike, rpm, totalWeight, 14, batteryWh);

    // --- Step 4: TURBO (static, fixed level) -------------------------
    const turboBp = blueprint('turbo');
    const turboPower = clamp(round(totalWeight * targetWkg.turbo), turboBp.minPower, bike.maxPower);
    const turboLevel = clamp(
        Math.max(findNearestAssistLevel(turboPower / pRider, turboBp.band[0], turboBp.band[1]), trailMax),
        turboBp.band[0],
        turboBp.band[1]
    );
    byKey.turbo = buildMode(turboBp, turboLevel, turboLevel, turboPower, pRider, bike, rpm, totalWeight, 10, batteryWh);

    // --- Global warnings ---------------------------------------------
    if (byKey.turbo.maxPower > maxPowerAtCadence) {
        const rpmNeeded = Math.ceil((byKey.turbo.maxPower * 9.55) / bike.maxTorque);
        globalWarnings.push(
            `At ${round(rpm)} RPM the ${bike.name} delivers at most ${maxPowerAtCadence} W ` +
            `(${bike.maxTorque} Nm x ${round(rpm)} / 9.55). The ${byKey.turbo.maxPower} W Turbo target ` +
            `needs at least ${rpmNeeded} RPM: spin faster or accept a lower power ceiling.`
        );
    }
    if (pRider < 120) {
        globalWarnings.push(
            'With a very low rider power the assist levels come out high: ' +
            'check that the value you entered matches how you actually ride.'
        );
    }

    // The M2S only reaches its full Boost output on the FP700 (700 Wh) pack.
    // This is surfaced in the Boost card only — no duplicate global banner.
    let boostNote: string | null = bike.note ?? null;
    if (bike.id === 'M2S') {
        boostNote = batteryWh === 700
            ? 'FP700 (700 Wh) pack: full 1500 W Boost is available.'
            : 'Full 1500 W Boost requires the FP700 (700 Wh) pack; with the selected battery peak output is lower.';
    }

    return res.json({
        bike,
        totalWeight,
        cadence: round(rpm),
        riderPower: round(pRider),
        batteryWh,
        maxPowerAtCadence,
        maxTorqueAtCadence: bike.maxTorque,
        targetWkg,
        entryGrid: { torqueStepNm: TORQUE_STEP_NM, powerStepW: POWER_STEP_W },
        boost: {
            torque: bike.boostTorque,
            power: bike.boostPower,
            duration: boostDuration,
            durationMin: BOOST_DURATION_MIN,
            durationMax: BOOST_DURATION_MAX,
            durationDefault: bike.boostDurationDefault,
            fullPowerRequires: bike.id === 'M2S' ? 'FP700 (700 Wh)' : null,
            fullPowerAvailable: bike.id !== 'M2S' || batteryWh === 700,
            note: boostNote
        },
        eco: byKey.eco,
        auto: byKey.auto,
        trail: byKey.trail,
        turbo: byKey.turbo,
        warnings: globalWarnings
    });
});

/* ------------------------------------------------------------------ *
 * ROUTE PLANNER — energy feasibility and mode distribution
 * ------------------------------------------------------------------ */

app.post('/api/calculate-mission', (req: Request, res: Response) => {
    const body = req.body ?? {};

    const riderWeight = parseFloat(body.riderWeight);
    const bikeWeight = parseFloat(body.bikeWeight);
    const rpm = parseFloat(body.cadence);
    const pRider = parseFloat(body.riderPower);
    const km = parseFloat(body.targetKm);
    const hm = parseFloat(body.targetH_m);

    if (![riderWeight, bikeWeight, rpm, pRider, km, hm].every((n) => Number.isFinite(n) && n > 0)) {
        return res.status(400).json({
            error: 'Invalid parameters: weights, cadence, rider power, distance and elevation must be positive numbers.'
        });
    }

    const bike = pickBike(body.bike);
    const batteryWh = pickNumber(body.batteryWh, 800);
    const totalWeight = riderWeight + bikeWeight;

    // --- Route-aware energy model ------------------------------------
    const surfaceId = SURFACE_FACTORS[String(body.surface)] ? String(body.surface) : 'mixed';
    const surfaceFactor = SURFACE_FACTORS[surfaceId];

    const reservePercent = clamp(pickNumber(body.reservePercent, 15), 0, 50);
    const reserveWh = (batteryWh * reservePercent) / 100;
    const usableWh = batteryWh - reserveWh;

    const gradeDistribution = normaliseDistribution(body.gradeDistribution);
    const steepShare = gradeDistribution
        ? (gradeDistribution.steep + gradeDistribution.extreme) / 100
        : 0;
    const steepnessFactor = 1 + STEEP_ENERGY_PENALTY * steepShare;

    const energyFlat = km * 3.8;
    const energyClimb = hm * 0.24 * (totalWeight / 100);
    const baseEnergy = energyFlat + energyClimb;

    const energyEstimated = baseEnergy * surfaceFactor * steepnessFactor;
    const qualityId = String(body.elevationQuality);
    const margin = QUALITY_MARGIN[qualityId] ?? QUALITY_MARGIN.noisy;
    const energyLow = energyEstimated * (1 - margin);
    const energyHigh = energyEstimated * (1 + margin);
    const confidence = qualityId === 'good' ? 'medium' : 'low';

    const totalEnergyRequired = Math.round(energyEstimated);

    let scalingFactor = 1.0;
    let feasible = true;

    if (totalEnergyRequired > usableWh) {
        scalingFactor = usableWh / totalEnergyRequired;
        feasible = false;
    }

    // Altitude share and profile usage planning (pie chart logic)
    const climbRatio = energyClimb / (energyFlat + energyClimb || 1);
    const flatRatio = 1 - climbRatio;

    let ecoPercent = (40 * flatRatio) + (15 * climbRatio);
    let autoPercent = (50 * flatRatio) + (45 * climbRatio);
    let trailPercent = (10 * flatRatio) + (32 * climbRatio);
    let turboPercent = (0 * flatRatio) + (8 * climbRatio);

    if (!feasible) {
        // On a critical loop, cut Turbo and Trail hard to force ECO/AUTO usage.
        turboPercent = turboPercent * Math.pow(scalingFactor, 2);
        trailPercent = trailPercent * scalingFactor;
        autoPercent = autoPercent * (0.4 + 0.6 * scalingFactor);
        ecoPercent = 100 - (turboPercent + trailPercent + autoPercent);
    }

    const totalPercentSum = ecoPercent + autoPercent + trailPercent + turboPercent;
    const distribution = {
        eco: Math.max(0, Math.round((ecoPercent / totalPercentSum) * 100)),
        auto: Math.max(0, Math.round((autoPercent / totalPercentSum) * 100)),
        trail: Math.max(0, Math.round((trailPercent / totalPercentSum) * 100)),
        turbo: Math.max(0, Math.round((turboPercent / totalPercentSum) * 100))
    };

    const finalSum = distribution.eco + distribution.auto + distribution.trail + distribution.turbo;
    if (finalSum !== 100) distribution.eco += (100 - finalSum);

    const ecoWkg = Math.max(0.75, 1.36 * scalingFactor);
    const autoWkg = Math.max(1.50, 2.73 * scalingFactor);
    const trailWkg = Math.max(2.50, 5.45 * scalingFactor);
    const turboWkg = Math.max(3.50, 7.72 * scalingFactor);

    const ecoBp = MODES[0];
    const autoBp = MODES[1];
    const trailBp = MODES[2];
    const turboBp = MODES[3];

    const snapPower = (w: number, bp: ModeBlueprint) =>
        snapToGrid(clamp(round(w), bp.minPower, bike.maxPower), POWER_STEP_W, bp.minPower, bike.maxPower);
    const snapTorque = (w: number) =>
        snapToGrid(round((w * 9.55) / rpm), TORQUE_STEP_NM, TORQUE_STEP_NM, bike.maxTorque);

    const ecoW = snapPower(totalWeight * ecoWkg, ecoBp);
    const ecoNm = snapTorque(ecoW);
    const ecoLvl = findNearestAssistLevel(ecoW / pRider, ecoBp.band[0], ecoBp.band[1]);

    const autoW = snapPower(totalWeight * autoWkg, autoBp);
    const autoNm = snapTorque(autoW);
    const autoMaxLvl = findNearestAssistLevel(autoW / pRider, autoBp.band[0], autoBp.band[1]);
    const autoMinLvl = clamp(Math.max(ecoLvl + 1, autoBp.band[0]), autoBp.band[0], autoMaxLvl);

    const trailW = snapPower(totalWeight * trailWkg, trailBp);
    const trailNm = snapTorque(trailW);
    const trailMaxLvl = findNearestAssistLevel(trailW / pRider, trailBp.band[0], trailBp.band[1]);
    // FIX: the mission endpoint had the same unclamped floor as /api/calculate.
    const trailMinLvl = clamp(Math.max(autoMaxLvl, trailBp.band[0]), trailBp.band[0], trailMaxLvl);

    const turboW = snapPower(totalWeight * turboWkg, turboBp);
    const turboNm = snapTorque(turboW);
    const turboLvl = clamp(
        Math.max(findNearestAssistLevel(turboW / pRider, turboBp.band[0], turboBp.band[1]), trailMaxLvl),
        turboBp.band[0],
        turboBp.band[1]
    );

    return res.json({
        feasible,
        energyRequired: totalEnergyRequired,
        scalingFactor,
        distribution,
        bike,
        energy: {
            base: Math.round(baseEnergy),
            estimated: Math.round(energyEstimated),
            low: Math.round(energyLow),
            high: Math.round(energyHigh),
            marginPercent: Math.round(margin * 100),
            flat: Math.round(energyFlat),
            climb: Math.round(energyClimb)
        },
        surface: { id: surfaceId, factor: surfaceFactor },
        steepnessFactor,
        reserve: { percent: reservePercent, wh: Math.round(reserveWh) },
        usableWh: Math.round(usableWh),
        confidence,
        gradeDistribution,
        climbSummary: body.climbSummary ?? null,
        eco: {
            level: `Level ${ecoLvl}`, levelPct: pctOfLevel(ecoLvl), watts: `${ecoW} W`,
            torque: `${ecoNm} Nm`,
            wkg: ecoWkg.toFixed(2)
        },
        auto: {
            level: `Level ${autoMinLvl} - ${autoMaxLvl}`,
            levelPct: `${pctOfLevel(autoMinLvl)} – ${pctOfLevel(autoMaxLvl)}`, watts: `${autoW} W`,
            torque: `${autoNm} Nm`,
            wkg: autoWkg.toFixed(2)
        },
        trail: {
            level: `Level ${trailMinLvl} - ${trailMaxLvl}`,
            levelPct: `${pctOfLevel(trailMinLvl)} – ${pctOfLevel(trailMaxLvl)}`, watts: `${trailW} W`,
            torque: `${trailNm} Nm`,
            wkg: trailWkg.toFixed(2)
        },
        turbo: {
            level: `Level ${turboLvl}`, levelPct: pctOfLevel(turboLvl), watts: `${turboW} W`,
            torque: `${turboNm} Nm`,
            wkg: turboWkg.toFixed(2)
        }
    });
});

/* ------------------------------------------------------------------ *
 * ROUTE MODES (Phase 3)
 * Proposes custom modes tailored to a specific route. Custom modes added
 * from the Avinox app use a FIXED assist level, never a range.
 * ------------------------------------------------------------------ */

interface ProposedMode {
    key: string;
    label: string;
    type: 'static';
    assistLevel: number;
    assistLevelPct: string;
    maxPower: number;
    maxTorque: number;
    maxOverrun: number;
    assistStart: number;
    continuedAssist: number;
    maxAccel: number | null;
    amplification: number;
    achievable: boolean;
    rationale: string;
}

app.post('/api/route-modes', (req: Request, res: Response) => {
    const body = req.body ?? {};

    const riderWeight = parseFloat(body.riderWeight);
    const bikeWeight = parseFloat(body.bikeWeight);
    const rpm = parseFloat(body.cadence);
    const pRider = parseFloat(body.riderPower);

    if (![riderWeight, bikeWeight, rpm, pRider].every((n) => Number.isFinite(n) && n > 0)) {
        return res.status(400).json({
            error: 'Invalid parameters: weights, cadence and rider power must be positive numbers.'
        });
    }
    if (rpm < 20 || rpm > 140) {
        return res.status(400).json({ error: 'Cadence outside the plausible range (20-140 RPM).' });
    }

    const bike = pickBike(body.bike);
    const totalWeight = riderWeight + bikeWeight;
    const batteryWh = pickNumber(body.batteryWh, 800);
    const reservePercent = clamp(pickNumber(body.reservePercent, 15), 0, 50);
    const usableWh = batteryWh * (1 - reservePercent / 100);

    const km = pickNumber(body.targetKm, 0);
    const hm = pickNumber(body.targetH_m, 0);
    const surfaceId = SURFACE_FACTORS[String(body.surface)] ? String(body.surface) : 'mixed';
    const gradeDistribution = normaliseDistribution(body.gradeDistribution);

    const summary = (body.climbSummary && typeof body.climbSummary === 'object')
        ? body.climbSummary as Record<string, unknown>
        : null;
    const climbCount = summary ? parseInt(String(summary.count), 10) || 0 : 0;
    const medianClimbGrade = summary ? parseFloat(String(summary.medianGrade)) || 0 : 0;
    const steepShare = gradeDistribution
        ? gradeDistribution.steep + gradeDistribution.extreme
        : 0;

    // Same model as /api/calculate-mission, so the verdict stays consistent.
    const energyEstimated = (km * 3.8 + hm * 0.24 * (totalWeight / 100))
        * SURFACE_FACTORS[surfaceId]
        * (1 + STEEP_ENERGY_PENALTY * (steepShare / 100));
    const tightOnBattery = energyEstimated > usableWh;

    const notes: string[] = [];

    function propose(
        key: string,
        label: string,
        wkg: number,
        dynamic: { overrun: number; start: number; continued: number },
        torqueFactor: number,
        rationale: string
    ): ProposedMode {
        const power = snapToGrid(
            clamp(round(totalWeight * wkg), 100, bike.maxPower),
            POWER_STEP_W, 100, bike.maxPower
        );
        const idealTorque = ((power * 9.55) / rpm) * torqueFactor;
        const torque = snapToGrid(
            round(idealTorque),
            TORQUE_STEP_NM, TORQUE_STEP_NM, bike.maxTorque
        );
        const level = findNearestAssistLevel(power / pRider, 1, 15);

        return {
            key,
            label,
            type: 'static',
            assistLevel: level,
            assistLevelPct: pctOfLevel(level),
            maxPower: power,
            maxTorque: torque,
            maxOverrun: dynamic.overrun,
            assistStart: dynamic.start,
            continuedAssist: dynamic.continued,
            maxAccel: null,
            amplification: pRider > 0 ? Math.round((power / pRider) * 100) / 100 : 0,
            achievable: idealTorque <= bike.maxTorque + 0.5,
            rationale
        };
    }

    const selected: ProposedMode[] = [];

    // ENDURANCE — the baseline for flat and rolling transit.
    selected.push(propose(
        'endurance', 'ROUTE ENDURANCE', 1.50,
        { overrun: 1, start: 2, continued: 2 }, 1.0,
        'Low fixed support for flat and rolling transit. Lowest consumption of the set.'
    ));

    // CLIMB — only when the route actually contains climbs.
    if (climbCount > 0) {
        const climbWkg = clamp(3.2 + Math.max(0, medianClimbGrade - 6) * 0.30, 2.5, 8.0);
        selected.push(propose(
            'climb', 'ROUTE CLIMB', climbWkg,
            { overrun: 2, start: 3, continued: 4 }, 1.0,
            `Tuned for the ${climbCount} climb(s) detected, median grade ${medianClimbGrade.toFixed(1)}%.`
        ));
    } else {
        notes.push('No climbs were detected, so a CLIMB mode was not proposed.');
    }

    // RESERVE wins over TECH: it is the safety-critical one.
    if (tightOnBattery) {
        selected.push(propose(
            'reserve', 'ROUTE RESERVE', 1.10,
            { overrun: 1, start: 1, continued: 1 }, 1.0,
            'The route exceeds the usable battery with a normal setup: use this to stretch the final part.'
        ));
    } else if (steepShare >= 12) {
        selected.push(propose(
            'tech', 'ROUTE TECH', 4.50,
            { overrun: 1, start: 2, continued: 5 }, 1.25,
            `Steep sections are ${steepShare.toFixed(0)}% of the route: soft ramp and extra torque for traction.`
        ));
    } else if (steepShare > 0) {
        notes.push('Steep sections are under 12% of the route, so a TECH mode was not proposed.');
    }

    if (!gradeDistribution) {
        notes.push('No grade distribution was supplied: proposals use distance and total gain only.');
    }
    notes.push('Custom modes in the Avinox app use a fixed assist level, never a range.');

    return res.json({
        bike,
        totalWeight,
        energyEstimated: Math.round(energyEstimated),
        usableWh: Math.round(usableWh),
        tightOnBattery,
        steepShare: Math.round(steepShare * 10) / 10,
        climbCount,
        medianClimbGrade: Math.round(medianClimbGrade * 10) / 10,
        surface: { id: surfaceId, factor: SURFACE_FACTORS[surfaceId] },
        modes: selected,
        notes
    });
});

app.listen(port, () => {
    console.log(`Avinox Mission Router running on port ${port}`);
});
