import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MODE_KEYS,
    MeasuredRides,
    ModeKey,
    PACK_EFFICIENCY_DEFAULT,
    REFERENCE_CLIMB_M_PER_KM,
    REFERENCE_SURFACE,
    estimateRouteEnergy,
    modeMixFor,
    packEfficiencyOf,
    personalFactorOf,
    reservePercentOf,
    surfaceIdOf,
    climbSpeedKmH,
    terrainEnergy,
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
