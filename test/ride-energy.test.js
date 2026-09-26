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

test('the client and the server refuse the same low consumption', () => {
    const model = require('../src/energy-model');
    assert.equal(constants.PLAUSIBLE_WH_PER_KM_MIN, model.PLAUSIBLE_WH_PER_KM_MIN);
});

const { describeAssistValues, rideEnergy: energyOf } = require('../public/ride-energy.js');

/* 1 Hz at 3 m/s over flat, 5%, 10% and 15% stretches, one assist value
   throughout; `ratioAt(grade)` sets the motor/rider ratio. */
function assistRide(assist, ratioAt) {
    const samples = [];
    let t = 1_700_000_000, km = 0, alt = 100;
    for (const grade of [0, 5, 10, 15]) {
        for (let i = 0; i < 300; i++) {
            samples.push({ timestamp: t++, assist, distanceKm: km, altitude: alt, riderPower: 150, motorPower: 150 * ratioAt(grade) });
            km += 0.003;
            alt += 3 * grade / 100;
        }
    }
    return samples;
}

test('a mode whose ratio does not follow the gradient is fixed', () => {
    const [d] = describeAssistValues(assistRide(1, () => 1.2));
    assert.equal(d.behaviour, 'fixed');
    assert.equal(d.label, 'ECO · fixed 1.2×');
});

test('a mode whose ratio grows with the gradient is dynamic', () => {
    const [d] = describeAssistValues(assistRide(4, (g) => 2.2 + g / 10));
    assert.equal(d.behaviour, 'dynamic');
    assert.equal(d.label, 'AUTO · dynamic 2.2×–3.7×');
});

test('1-4 are named, 20 and up are custom modes, the others keep their number', () => {
    assert.equal(describeAssistValues(assistRide(21, () => 2.2))[0].label, 'custom 21 · fixed 2.2×');
    assert.equal(describeAssistValues(assistRide(3, () => 6))[0].label, 'TURBO · fixed 6.0×');
    assert.equal(describeAssistValues(assistRide(2, () => 2.7))[0].label, 'TRAIL · fixed 2.7×');
    assert.equal(describeAssistValues(assistRide(7, () => 1))[0].label, 'assist 7 · fixed 1.0×');
});

test('a value with no motor output, or too few samples, says so', () => {
    assert.equal(describeAssistValues(assistRide(5, () => 0))[0].behaviour, 'none');
    assert.equal(describeAssistValues(assistRide(2, () => 1).slice(0, 10))[0].behaviour, 'brief');
});

test('the rider energy is integrated with the motor energy', () => {
    const e = energyOf(assistRide(1, () => 1.2));
    assert.ok(Math.abs(e.riderWh - 150 * 1200 / 3600) < 0.5);
    assert.ok(Math.abs(e.motorWh / e.riderWh - 1.2) < 1e-9);
});

test('samples above the assist cut-off speed do not read as a weaker mode', () => {
    const samples = assistRide(3, () => 6).map((s, i) => (i < 300 ? { ...s, speed: 30, motorPower: 0 } : { ...s, speed: 12 }));
    assert.equal(describeAssistValues(samples)[0].label, 'TURBO · fixed 6.0×');
});
