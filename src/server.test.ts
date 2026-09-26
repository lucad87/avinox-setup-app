import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { app } from './server';

let server: Server;
let baseUrl: string;

before(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
    server.close();
});

const RIDER = {
    bike: 'M2S', batteryWh: 800, riderWeight: 80, bikeWeight: 22, cadence: 80, riderPower: 150
};

async function post(path: string, body: object) {
    const res = await fetch(baseUrl + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() as Record<string, any> };
}

test('a flat route (zero elevation gain) is analysed', async () => {
    const r = await post('/api/calculate-mission', { ...RIDER, targetKm: 40, targetH_m: 0 });
    assert.equal(r.status, 200);
    assert.equal(r.body.feasible, true);
});

test('a negative elevation gain is refused', async () => {
    const r = await post('/api/calculate-mission', { ...RIDER, targetKm: 40, targetH_m: -5 });
    assert.equal(r.status, 400);
});

test('the proposed modes and the feasibility verdict agree on a calibrated route', async () => {
    /* The case that used to disagree: FEASIBLE on one side, a RESERVE mode
       "the route exceeds the usable battery" on the other. */
    const route = {
        ...RIDER, targetKm: 70, targetH_m: 1500, surface: 'mixed',
        realWhPerKm: 6, realKm: 50, realHm: 800, realSurface: 'mixed', realEfficiency: 0.8
    };
    const mission = await post('/api/calculate-mission', route);
    const modes = await post('/api/route-modes', route);
    assert.equal(mission.status, 200);
    assert.equal(modes.status, 200);
    assert.equal(modes.body.energyEstimated, mission.body.energy.estimated);
    assert.equal(modes.body.tightOnBattery, !mission.body.feasible);
    assert.equal(modes.body.basedOnRealRides, mission.body.basedOnRealRides);
});

test('a recording replayed as a route projects its own measured pack energy', async () => {
    const r = await post('/api/calculate-mission', {
        ...RIDER, targetKm: 40, targetH_m: 1000, surface: 'technical', elevationQuality: 'good',
        realWhPerKm: 9, realKm: 40, realHm: 1000, realSurface: 'technical', realEfficiency: 0.9
    });
    const measuredPackWh = (9 / 0.9) * 40;
    assert.equal(r.status, 200);
    assert.equal(r.body.basedOnRealRides, true);
    assert.ok(Math.abs(r.body.energy.estimated - measuredPackWh) / measuredPackWh < 0.05);
    assert.equal(r.body.packEfficiency, 0.9);
    assert.equal(r.body.realPackWhPerKm, 10);
});

test('a calibration stored before surface and efficiency existed still applies', async () => {
    const r = await post('/api/calculate-mission', {
        ...RIDER, targetKm: 40, targetH_m: 1000, realWhPerKm: 9, realKm: 40, realHm: 1000
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.basedOnRealRides, true);
    assert.equal(r.body.packEfficiency, 0.8);
});

test('a reserve of zero is honoured by both route endpoints', async () => {
    const route = { ...RIDER, targetKm: 40, targetH_m: 500, reservePercent: 0 };
    const mission = await post('/api/calculate-mission', route);
    const modes = await post('/api/route-modes', route);
    assert.equal(mission.body.usableWh, 800);
    assert.equal(modes.body.usableWh, 800);
});

test('the Tuner and the Route quote the same consumption for the same ground', async () => {
    const tuner = await post('/api/calculate', RIDER);
    const route = await post('/api/calculate-mission', {
        ...RIDER, targetKm: 40, targetH_m: 40 * tuner.body.rangeModel.referenceClimbMPerKm,
        surface: tuner.body.rangeModel.referenceSurface
    });
    assert.equal(tuner.status, 200);
    assert.ok(Math.abs(route.body.energy.estimated / 40 - tuner.body.rangeModel.referenceWhPerKm) < 0.1);
});

test('the Tuner uses the calibration the client sends', async () => {
    const generic = await post('/api/calculate', RIDER);
    const calibrated = await post('/api/calculate', {
        ...RIDER, realWhPerKm: 9, realKm: 40, realHm: 1000, realEfficiency: 0.8, realSurface: 'mixed'
    });
    assert.equal(generic.body.basedOnRealRides, false);
    assert.equal(calibrated.body.basedOnRealRides, true);
    assert.equal(calibrated.body.eco.basedOnRealRides, true);
    assert.notEqual(calibrated.body.eco.range, generic.body.eco.range);
});

test('the Tuner ranges stay plausible at the default setup', async () => {
    const r = await post('/api/calculate', RIDER);
    for (const k of ['eco', 'auto', 'trail', 'turbo']) {
        assert.ok(r.body[k].whPerKm > 2.5 && r.body[k].whPerKm < 50, `${k}: ${r.body[k].whPerKm} Wh/km`);
    }
    assert.equal(r.body.stock.length, 4);
});
