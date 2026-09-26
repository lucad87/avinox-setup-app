import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MeasuredRides,
    PACK_EFFICIENCY_DEFAULT,
    estimateRouteEnergy,
    packEfficiencyOf,
    personalFactorOf,
    reservePercentOf,
    surfaceIdOf,
    terrainEnergy
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
