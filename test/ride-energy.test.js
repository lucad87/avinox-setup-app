const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rideEnergy, packEfficiency, constants } = require('../public/ride-energy.js');

/* One sample per second at a constant motor power, battery falling linearly. */
function syntheticRide({ seconds, motorW, km, batteryFrom, batteryTo }) {
    const samples = [];
    for (let t = 0; t < seconds; t++) {
        samples.push({
            timestamp: 1_700_000_000 + t,
            motorPower: motorW,
            distanceKm: (km * t) / (seconds - 1),
            battery: Math.round(batteryFrom + ((batteryTo - batteryFrom) * t) / (seconds - 1))
        });
    }
    return samples;
}

test('motor energy integrates power over time', () => {
    const e = rideEnergy(syntheticRide({ seconds: 3600, motorW: 200, km: 20, batteryFrom: 100, batteryTo: 70 }));
    assert.ok(Math.abs(e.motorWh - 200) < 0.1);
    assert.equal(e.km, 20);
    assert.equal(e.batteryStart, 100);
    assert.equal(e.batteryEnd, 70);
});

test('a pause longer than the sample interval cap is not counted as riding', () => {
    const samples = [
        { timestamp: 100, motorPower: 360, distanceKm: 0 },
        { timestamp: 101, motorPower: 360, distanceKm: 0.01 },
        { timestamp: 1101, motorPower: 360, distanceKm: 0.02 }
    ];
    const e = rideEnergy(samples);
    const expectedS = 1 + 1 + constants.MAX_SAMPLE_INTERVAL_S;
    assert.ok(Math.abs(e.motorWh - (360 * expectedS) / 3600) < 1e-9);
});

test('pack efficiency is the motor energy over the battery drop', () => {
    // 240 Wh of motor energy for a 37.5 % drop of an 800 Wh pack = 300 Wh.
    const r = packEfficiency([{ motorWh: 240, batteryStart: 90, batteryEnd: 52.5 }], 800);
    assert.equal(r.measured, true);
    assert.ok(Math.abs(r.efficiency - 0.8) < 1e-9);
});

test('rides are pooled before the efficiency is computed', () => {
    const r = packEfficiency([
        { motorWh: 100, batteryStart: 100, batteryEnd: 85 },
        { motorWh: 110, batteryStart: 85, batteryEnd: 70 }
    ], 800);
    assert.equal(r.dropPct, 30);
    assert.ok(Math.abs(r.efficiency - 210 / 240) < 1e-9);
});

test('a battery drop too small to read falls back to the default', () => {
    const r = packEfficiency([{ motorWh: 50, batteryStart: 90, batteryEnd: 82 }], 800);
    assert.equal(r.measured, false);
    assert.equal(r.reason, 'battery-drop-too-small');
    assert.equal(r.efficiency, constants.EFFICIENCY_DEFAULT);
});

test('an efficiency no drive can have falls back to the default and says why', () => {
    // A range extender feeds the motor while the main pack barely moves.
    const r = packEfficiency([{ motorWh: 400, batteryStart: 100, batteryEnd: 80 }], 800);
    assert.equal(r.measured, false);
    assert.equal(r.reason, 'out-of-range');
    assert.ok(r.value > constants.EFFICIENCY_MAX);
    assert.equal(r.efficiency, constants.EFFICIENCY_DEFAULT);
});

test('a ride that was charged or has no gauge is left out of the drop', () => {
    const r = packEfficiency([
        { motorWh: 200, batteryStart: 60, batteryEnd: 80 },
        { motorWh: 200, batteryStart: null, batteryEnd: null },
        { motorWh: 240, batteryStart: 90, batteryEnd: 52.5 }
    ], 800);
    assert.equal(r.dropPct, 37.5);
    assert.ok(Math.abs(r.efficiency - 0.8) < 1e-9);
});
