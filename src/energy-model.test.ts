import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_SURFACE_MIX,
    MODE_KEYS,
    MeasuredRides,
    ModeKey,
    PACK_EFFICIENCY_DEFAULT,
    REFERENCE_CLIMB_M_PER_KM,
    REFERENCE_SURFACE,
    SURFACE_VOICES,
    SURFACE_VOICE_KEYS,
    SurfaceMix,
    SurfaceVoiceId,
    dominantSurfaceVoiceOf,
    energyFactorOf,
    estimateRouteEnergy,
    legacySurfaceMix,
    modeMixFor,
    normaliseSurfaceMix,
    packEfficiencyOf,
    personalFactorOf,
    reservePercentOf,
    softRampOf,
    surfaceIdOf,
    surfaceMixFrom,
    surfaceMixReport,
    climbSpeedKmH,
    terrainEnergy,
    torqueFactorOf,
    tunerRanges
} from './energy-model';

const WEIGHT = 102;

function ride(overrides: Partial<MeasuredRides> = {}): MeasuredRides {
    return {
        motorWhPerKm: 9,
        km: 40,
        hm: 1000,
        efficiency: 0.8,
        surfaceId: 'mixed',
        steepShare: 0.1,
        motorShare: null,
        ...overrides
    };
}

test('replaying a recording projects the energy it measured, whatever the surface', () => {
    for (const surfaceId of ['road', 'gravel', 'mixed', 'technical']) {
        const measured = ride({ surfaceId });
        const e = estimateRouteEnergy({
            km: measured.km,
            hm: measured.hm,
            totalWeight: WEIGHT,
            surfaceId,
            steepShare: measured.steepShare,
            batteryWh: 800,
            reservePercent: 15,
            elevationQuality: 'good',
            real: measured
        });
        const measuredPackWh = (measured.motorWhPerKm / measured.efficiency) * measured.km;
        assert.ok(Math.abs(e.estimated - measuredPackWh) / measuredPackWh < 0.05,
            `${surfaceId}: projected ${e.estimated.toFixed(0)} Wh vs measured ${measuredPackWh.toFixed(0)} Wh`);
    }
});

test('the surface of the calibration rides is not applied twice to a route', () => {
    const route = { km: 60, hm: 1200, totalWeight: WEIGHT, surfaceId: 'mixed', steepShare: 0.1 };
    const calibrated = personalFactorOf(ride({ surfaceId: 'mixed' }), WEIGHT);
    const estimate = terrainEnergy(route).estimated * calibrated.factor;
    const packWhPerKm = 9 / 0.8;
    const rideModelWhPerKm = terrainEnergy({ ...ride(), totalWeight: WEIGHT }).estimated / 40;
    const routeModelWhPerKm = terrainEnergy(route).estimated / 60;
    const expected = packWhPerKm * (routeModelWhPerKm / rideModelWhPerKm) * 60;
    assert.ok(Math.abs(estimate - expected) < 1e-6);
});

test('motor energy is converted to pack energy with the measured efficiency', () => {
    const at80 = personalFactorOf(ride({ efficiency: 0.8 }), WEIGHT);
    const at90 = personalFactorOf(ride({ efficiency: 0.9 }), WEIGHT);
    assert.equal(at80.packWhPerKm, 9 / 0.8);
    assert.equal(at90.packWhPerKm, 9 / 0.9);
    assert.ok(at80.factor > at90.factor);
});

test('an efficiency outside the plausible window falls back to the default', () => {
    assert.equal(packEfficiencyOf(0.85), 0.85);
    assert.equal(packEfficiencyOf(0.4), PACK_EFFICIENCY_DEFAULT);
    assert.equal(packEfficiencyOf(1.2), PACK_EFFICIENCY_DEFAULT);
    assert.equal(packEfficiencyOf(undefined), PACK_EFFICIENCY_DEFAULT);
});

test('an implausible measurement is reported and not applied', () => {
    const tooLow = personalFactorOf(ride({ motorWhPerKm: 1.7 }), WEIGHT);
    assert.equal(tooLow.rejected, 'consumption-too-low');
    assert.equal(tooLow.factor, 1);
    assert.equal(tooLow.applied, false);

    const outOfRange = personalFactorOf(ride({ motorWhPerKm: 40 }), WEIGHT);
    assert.equal(outOfRange.rejected, 'factor-out-of-range');
    assert.equal(outOfRange.factor, 1);
});

test('no measurement leaves the model untouched', () => {
    const p = personalFactorOf(null, WEIGHT);
    assert.equal(p.factor, 1);
    assert.equal(p.applied, false);
});

test('a flat route is a valid route', () => {
    const e = estimateRouteEnergy({
        km: 40, hm: 0, totalWeight: WEIGHT, surfaceId: 'road', steepShare: 0,
        batteryWh: 800, reservePercent: 15, elevationQuality: 'good', real: null
    });
    assert.equal(Math.round(e.estimated), 152);
    assert.equal(e.feasible, true);
    assert.equal(e.scalingFactor, 1);
});

test('the verdict compares the estimate with the usable battery after the reserve', () => {
    const base = { hm: 0, totalWeight: WEIGHT, surfaceId: 'road', steepShare: 0,
        batteryWh: 800, reservePercent: 15, elevationQuality: 'good', real: null };
    assert.equal(estimateRouteEnergy({ ...base, km: 178 }).feasible, true);   // 676 Wh of 680
    const over = estimateRouteEnergy({ ...base, km: 180 });                   // 684 Wh of 680
    assert.equal(over.feasible, false);
    assert.ok(Math.abs(over.scalingFactor - 680 / 684) < 1e-9);
});

test('a reserve of zero is kept, not replaced by the default', () => {
    assert.equal(reservePercentOf(0), 0);
    assert.equal(reservePercentOf('20'), 20);
    assert.equal(reservePercentOf(90), 50);
    assert.equal(reservePercentOf(undefined), 15);
});

test('an unknown surface is read as mixed', () => {
    assert.equal(surfaceIdOf('gravel'), 'gravel');
    assert.equal(surfaceIdOf('ice'), 'mixed');
    assert.equal(surfaceIdOf(undefined), 'mixed');
});

/* ------------------------------------------------------------------
 * SURFACE COMPOSITION
 * ------------------------------------------------------------------ */

const NO_SURFACE: SurfaceMix = { tarmac: 0, compacted: 0, hardpack: 0, mixed: 0, rock: 0, mud: 0 };

function sharesOf(mix: SurfaceMix): number[] {
    return SURFACE_VOICE_KEYS.map((key) => mix[key]);
}

test('the six surface voices carry the agreed energy and torque factors', () => {
    const expected: Record<SurfaceVoiceId, [number, number]> = {
        tarmac: [1.00, 1.15],
        compacted: [1.12, 1.05],
        hardpack: [1.18, 1.00],
        mixed: [1.22, 0.90],
        rock: [1.35, 0.85],
        mud: [1.55, 0.95]
    };
    for (const key of SURFACE_VOICE_KEYS) {
        assert.equal(SURFACE_VOICES[key].id, key);
        assert.equal(SURFACE_VOICES[key].energy, expected[key][0], `${key} energy`);
        assert.equal(SURFACE_VOICES[key].torque, expected[key][1], `${key} torque`);
    }
    assert.equal(SURFACE_VOICES.mud.softRamp, true);
    for (const key of SURFACE_VOICE_KEYS) {
        if (key !== 'mud') assert.ok(!SURFACE_VOICES[key].softRamp, `${key} must not ask for the soft ramp`);
    }
});

test('each legacy surface id resolves to its split and its weighted factors', () => {
    const legacy: Array<[string, Partial<SurfaceMix>, number, number]> = [
        ['road', { tarmac: 100 }, 1.00, 1.15],
        ['gravel', { compacted: 100 }, 1.12, 1.05],
        ['mixed', { compacted: 20, hardpack: 40, mixed: 40 }, 1.184, 0.97],
        ['technical', { rock: 100 }, 1.35, 0.85]
    ];
    for (const [id, split, energy, torque] of legacy) {
        const mix = legacySurfaceMix(id);
        assert.ok(mix, `${id} must resolve`);
        for (const key of SURFACE_VOICE_KEYS) {
            assert.equal(mix![key], (split as Record<string, number>)[key] ?? 0, `${id}/${key}`);
        }
        assert.ok(Math.abs(energyFactorOf(mix!) - energy) < 1e-9, `${id}: ${energyFactorOf(mix!)}`);
        assert.ok(Math.abs(torqueFactorOf(mix!) - torque) < 1e-9, `${id}: ${torqueFactorOf(mix!)}`);
    }
    assert.equal(legacySurfaceMix('ice'), null);
});

test('a mix of any sum is normalised to percentages of 100', () => {
    const mix = normaliseSurfaceMix({ tarmac: 10, mud: 30 });
    assert.ok(mix);
    assert.equal(mix!.tarmac, 25);
    assert.equal(mix!.mud, 75);
    assert.equal(sharesOf(mix!).reduce((sum, n) => sum + n, 0), 100);
});

test('negative shares are dropped and a mix with no weight is null', () => {
    const mix = normaliseSurfaceMix({ tarmac: -40, rock: 60 });
    assert.ok(mix);
    assert.equal(mix!.tarmac, 0);
    assert.equal(mix!.rock, 100);
    assert.equal(normaliseSurfaceMix({ tarmac: -40, rock: -60 }), null);
    assert.equal(normaliseSurfaceMix({}), null);
    assert.equal(normaliseSurfaceMix(null), null);
});

test('a string-valued mix normalises exactly like numbers', () => {
    const numbers = normaliseSurfaceMix({ tarmac: 15, mixed: 35 });
    const strings = normaliseSurfaceMix({ tarmac: '15', mixed: '35' });
    assert.deepEqual(strings, numbers);
    assert.equal(strings!.tarmac, 30);
    assert.equal(strings!.mixed, 70);
});

test('a zero or absent mix falls back to the legacy mixed preset', () => {
    assert.deepEqual(DEFAULT_SURFACE_MIX, legacySurfaceMix('mixed'));
    assert.deepEqual(surfaceMixFrom({}, undefined), DEFAULT_SURFACE_MIX);
    assert.deepEqual(surfaceMixFrom({ tarmac: 0, rock: -5 }, 'ice'), DEFAULT_SURFACE_MIX);
    assert.deepEqual(surfaceMixFrom(null, 'road'), legacySurfaceMix('road'));
    assert.equal(DEFAULT_SURFACE_MIX.hardpack, 40);
});

test('the soft ramp triggers at exactly a quarter rock or mud', () => {
    assert.equal(softRampOf({ ...NO_SURFACE, tarmac: 75, rock: 25 }), true);
    assert.equal(softRampOf({ ...NO_SURFACE, tarmac: 75.1, rock: 24.9 }), false);
    assert.equal(softRampOf({ ...NO_SURFACE, tarmac: 75, mud: 25 }), true);
    assert.equal(softRampOf({ ...NO_SURFACE, tarmac: 50, rock: 10, mud: 15 }), true);
    assert.equal(softRampOf(DEFAULT_SURFACE_MIX), false);
});

test('the dominant voice is the largest share and a tie keeps the voice order', () => {
    assert.equal(dominantSurfaceVoiceOf({ ...NO_SURFACE, tarmac: 30, rock: 70 }), 'rock');
    assert.equal(dominantSurfaceVoiceOf({ ...NO_SURFACE, rock: 50, mud: 50 }), 'rock');
    assert.equal(dominantSurfaceVoiceOf({ ...NO_SURFACE, hardpack: 40, mixed: 40 }), 'hardpack');
    assert.equal(dominantSurfaceVoiceOf(legacySurfaceMix('mixed')!), 'hardpack');
});

test('the mix report carries the normalised shares and the figures the endpoints quote', () => {
    const report = surfaceMixReport({ ...NO_SURFACE, rock: 70, tarmac: 30 });
    assert.equal(report.rock, 70);
    assert.equal(report.tarmac, 30);
    assert.equal(report.mud, 0);
    assert.ok(Math.abs(report.factor - 1.245) < 1e-9);
    assert.ok(Math.abs(report.torqueFactor - 0.94) < 1e-9);
    assert.equal(report.softRamp, true);
});

/* Motor watts at the default Tuner setup (102 kg, 150 W, 80 RPM) and for the
   DJI stock modes with the same rider. */
const CUSTOM_W: Record<ModeKey, number> = { eco: 150, auto: 300, trail: 550, turbo: 800 };
const STOCK_W: Record<ModeKey, number> = { eco: 200, auto: 773, trail: 773, turbo: 1050 };

function tuner(overrides: Partial<Parameters<typeof tunerRanges>[0]> = {}) {
    return tunerRanges({
        totalWeight: WEIGHT, batteryWh: 800, riderW: 150,
        modeMotorW: CUSTOM_W, stockMotorW: STOCK_W, real: null,
        ...overrides
    });
}

test('the stock modes, mixed as the route model mixes them, consume what the route model says', () => {
    const t = tuner();
    const reference = terrainEnergy({
        km: 1, hm: REFERENCE_CLIMB_M_PER_KM, totalWeight: WEIGHT, surfaceId: REFERENCE_SURFACE, steepShare: 0
    });
    const mixed = MODE_KEYS.reduce((sum, k) => sum + t.mix[k] * t.stock[k].whPerKm, 0);
    assert.ok(Math.abs(t.referenceWhPerKm - reference.estimated) < 1e-9);
    assert.ok(Math.abs(mixed - reference.estimated) < 0.1, `stock mix ${mixed} vs route ${reference.estimated}`);
});

test('no mode exceeds the plausible consumption, and more assist costs more', () => {
    const t = tuner();
    for (const k of MODE_KEYS) assert.ok(t.modes[k].whPerKm < 50, `${k}: ${t.modes[k].whPerKm} Wh/km`);
    assert.ok(t.modes.eco.whPerKm < t.modes.auto.whPerKm);
    assert.ok(t.modes.auto.whPerKm < t.modes.trail.whPerKm);
    assert.ok(t.modes.trail.whPerKm < t.modes.turbo.whPerKm);
    assert.ok(t.modes.eco.range > t.modes.turbo.range);
});

test('changing one mode leaves the others alone', () => {
    const before = tuner();
    const after = tuner({ modeMotorW: { ...CUSTOM_W, trail: 700 } });
    assert.ok(after.modes.trail.range < before.modes.trail.range);
    for (const k of ['eco', 'auto', 'turbo'] as ModeKey[]) assert.deepEqual(after.modes[k], before.modes[k]);
});

test('a calibration without a motor share scales the stock anchor on the rides\' ground', () => {
    const calibrated = tuner({ real: ride() });
    assert.equal(calibrated.personal.applied, true);
    assert.equal(calibrated.ground.basis, 'rides');
    assert.equal(calibrated.ground.climbMPerKm, 25);   // 1000 m over 40 km
    assert.equal(calibrated.anchor, 'stock');
    // The reference consumption is the measured one, in pack energy.
    assert.ok(Math.abs(calibrated.referenceWhPerKm - 9 / 0.8) < 1e-9);
});

test('a calibration with a motor share anchors every mode on the rides', () => {
    const t = tuner({ real: ride({ motorShare: 0.65 }) });
    assert.equal(t.anchor, 'rides');
    for (const k of MODE_KEYS) {
        const share = CUSTOM_W[k] / (CUSTOM_W[k] + 150);
        assert.ok(Math.abs(t.modes[k].whPerKm - Math.round((9 / 0.8) * share / 0.65 * 10) / 10) < 1e-9, k);
    }
});

test('an implausible calibration leaves the Tuner on the reference ground', () => {
    const t = tuner({ real: ride({ motorWhPerKm: 1.5, motorShare: 0.65 }) });
    assert.equal(t.ground.basis, 'reference');
    assert.equal(t.anchor, 'stock');
});

test('the climbing speed reproduces the two recorded rides', () => {
    // 105 kg, 121 W average pedalling: ECO at 1.2x climbed at 8.5 km/h, AUTO at 3x at 10.3.
    assert.ok(Math.abs(climbSpeedKmH(121, 1.2 * 121, 105) - 8.5) < 0.3);
    assert.ok(Math.abs(climbSpeedKmH(121, 3.03 * 121, 105) - 10.3) < 0.3);
});

test('a stronger mode empties the battery in fewer hours than kilometres alone suggest', () => {
    const t = tuner({ real: ride({ motorShare: 0.65 }) });
    assert.ok(t.modes.turbo.speedKmH > t.modes.eco.speedKmH);
    const hours = t.modes.eco.runtime / t.modes.turbo.runtime;
    const km = t.modes.eco.range / t.modes.turbo.range;
    assert.ok(hours > km, `hours x${hours.toFixed(2)} vs km x${km.toFixed(2)}`);
});

test('the mode mix covers the whole distance on any terrain', () => {
    for (const c of [0, 0.3, 1]) {
        const m = modeMixFor(c);
        assert.ok(Math.abs(m.eco + m.auto + m.trail + m.turbo - 1) < 1e-12);
    }
});
