const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../public/avinox-proto-parser.js');
const { buildProto } = require('./proto-fixture.js');

const BASE = {
    timestamp: 1_750_000_000, speed: 18.5, assist: 2, cadence: 75, riderPower: 150,
    motorPower: 220, distanceKm: 1.25, latitude: 46.1234567, longitude: 11.7654321,
    altitude: 512.34, temperature: 21.5, battery: 87
};

test('a sample is read back with its scaling', () => {
    const { metadata, samples } = parse(buildProto([BASE], { rideId: 42, ascent: 600 }), 'ride.proto');
    assert.equal(metadata.rideId, 42);
    assert.ok(Math.abs(metadata.ascent - 600) < 1e-3);
    const s = samples[0];
    assert.equal(s.speed, 18.5);
    assert.equal(s.cadence, 75);
    assert.equal(s.motorPower, 220);
    assert.equal(s.distanceKm, 1.25);
    assert.equal(s.latitude, 46.1234567);
    assert.equal(s.longitude, 11.7654321);
    assert.equal(s.altitude, 512.34);
    assert.equal(s.temperature, 21.5);
    assert.equal(s.battery, 87);
});

test('a missing altitude or temperature is null, not zero', () => {
    const { samples } = parse(buildProto([{ ...BASE, altitude: undefined, temperature: undefined }]));
    assert.equal(samples[0].altitude, null);
    assert.equal(samples[0].temperature, null);
});

test('an altitude below sea level stays negative', () => {
    const { samples } = parse(buildProto([{ ...BASE, altitude: -7.5 }]));
    assert.equal(samples[0].altitude, -7.5);
});

test('a missing GPS fix leaves the position null', () => {
    const { samples } = parse(buildProto([{ ...BASE, latitude: undefined, longitude: undefined }]));
    assert.equal(samples[0].latitude, null);
    assert.equal(samples[0].longitude, null);
});

test('a file that is not a recording is refused', () => {
    assert.throws(() => parse(new ArrayBuffer(300)), /not an Avinox/);
});
