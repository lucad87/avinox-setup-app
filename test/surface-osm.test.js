'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    fetchSurfaceMix,
    buildQuery,
    samplePoints,
    classifyTags,
    matchWay,
    haversine,
    VOICES
} = require('../public/surface-osm.js');

/* The module's own Earth radius, so a constructed track measures exactly. */
const M_PER_DEG = 6371000 * Math.PI / 180;

/** A straight north-going track: points every `stepM` metres, `lengthM` long. */
function straightTrack(lengthM, stepM) {
    const points = [];
    for (let d = 0; d <= lengthM + 1e-9; d += stepM) {
        points.push({ lat: 45 + d / M_PER_DEG, lon: 10 });
    }
    return points;
}

function okResponse(elements) {
    return { ok: true, status: 200, json: async () => ({ elements }) };
}

test('the query contains every sampled coordinate and the [highway] filter', () => {
    const points = straightTrack(2000, 250);
    const samples = samplePoints(points, 500);
    assert.equal(samples.length, 5);
    const query = buildQuery(points, 500, 25);
    assert.match(query, /^\[out:json\]\[timeout:25\];way\(around:25,/);
    assert.ok(query.endsWith(')[highway];out tags geom;'), query);
    assert.equal((query.match(/-?\d+\.\d{6},-?\d+\.\d{6}/g) || []).length, samples.length);
    for (const s of samples) {
        assert.ok(query.includes(`${s.lat.toFixed(6)},${s.lon.toFixed(6)}`),
            `query is missing ${s.lat},${s.lon}`);
    }
});

test('samplePoints on a 2 km straight track with 500 m gives 5 points', () => {
    const samples = samplePoints(straightTrack(2000, 100), 500);
    assert.equal(samples.length, 5);
    assert.equal(samples[0].km, 0);
    assert.ok(Math.abs(samples[4].km - 2) < 1e-6, `last km = ${samples[4].km}`);
    for (let i = 1; i < samples.length; i++) {
        const leg = haversine(samples[i - 1], samples[i]);
        assert.ok(Math.abs(leg - 500) < 0.5, `leg ${i} = ${leg} m`);
    }
});

test('classifyTags maps one example per voice exactly, and refuses to guess', () => {
    const cases = [
        [{ surface: 'asphalt' }, 'tarmac'],
        [{ surface: 'paving_stones' }, 'tarmac'],
        [{ surface: 'compacted' }, 'compacted'],
        [{ surface: 'fine_gravel' }, 'compacted'],
        [{ surface: 'gravel', tracktype: 'grade1' }, 'compacted'],
        [{ surface: 'ground' }, 'hardpack'],
        [{ surface: 'grass_paver' }, 'hardpack'],
        [{ surface: 'gravel' }, 'mixed'],
        [{ surface: 'cobblestone' }, 'mixed'],
        [{ surface: 'rock' }, 'rock'],
        [{ surface: 'mud' }, 'mud'],
        [{ surface: 'sand' }, 'mud'],
        [{ highway: 'track' }, null],
        [{ highway: 'residential' }, null],
        [{ highway: 'path', surface: 'woodchips' }, null],
        [null, null]
    ];
    for (const [tags, expected] of cases) {
        assert.equal(classifyTags(tags), expected, JSON.stringify(tags));
    }
    const covered = new Set(cases.map(([, voice]) => voice).filter(Boolean));
    assert.deepEqual([...covered].sort(), [...VOICES].sort());
});

test('an mtb:scale=3 path is rock', () => {
    assert.equal(classifyTags({ highway: 'path', 'mtb:scale': '3' }), 'rock');
    assert.equal(classifyTags({ highway: 'path', 'mtb:scale': '1' }), null);
    assert.equal(classifyTags({ highway: 'path', sac_scale: 'alpine_hiking' }), 'rock');
    assert.equal(classifyTags({ highway: 'path', sac_scale: 'hiking' }), null);
});

test('matchWay picks the closest way geometry within the radius and null outside', () => {
    const point = { lat: 45, lon: 10 };
    const near = {
        id: 1,
        tags: { surface: 'asphalt' },
        geometry: [{ lat: 45, lon: 10.0001 }, { lat: 45.0002, lon: 10.0001 }]
    };
    const far = {
        id: 2,
        tags: { surface: 'mud' },
        geometry: [{ lat: 45.0005, lon: 10 }, { lat: 45.0006, lon: 10 }]
    };
    const match = matchWay(point, [far, near], 20);
    assert.equal(match.way.id, 1);
    assert.ok(Math.abs(match.distanceM - 7.86) < 0.2, `${match.distanceM} m`);
    assert.equal(matchWay(point, [far], 20), null);
    assert.equal(matchWay(point, [near], 5), null);

    // The nearest point may be in the middle of a segment, not an endpoint.
    const line = {
        id: 3,
        geometry: [{ lat: 45.0001, lon: 10 }, { lat: 45.0001, lon: 10.001 }]
    };
    const mid = matchWay({ lat: 45, lon: 10.0005 }, [line], 20);
    assert.equal(mid.way.id, 3);
    assert.ok(Math.abs(mid.distanceM - 11.12) < 0.3, `${mid.distanceM} m`);
});

test('the mix percentages sum to 100 on a fixed fake response', async () => {
    const points = straightTrack(1500, 100); // samples at 0, 0.5, 1 and 1.5 km
    const samples = samplePoints(points, 500);
    assert.equal(samples.length, 4);

    const tarmacWay = {
        type: 'way',
        id: 11,
        tags: { highway: 'track', surface: 'asphalt' },
        geometry: [{ lat: 45, lon: 10.0001 }, { lat: 45.02, lon: 10.0001 }]
    };
    const mudWay = {
        type: 'way',
        id: 12,
        tags: { highway: 'track', surface: 'mud' },
        geometry: [{ lat: samples[2].lat, lon: 10 }, { lat: samples[3].lat, lon: 10 }]
    };

    const calls = [];
    const result = await fetchSurfaceMix(points, {
        sampleM: 500,
        fetch: async (url, init) => {
            calls.push({ url, init });
            return okResponse([tarmacWay, mudWay]);
        }
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://overpass-api.de/api/interpreter');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(calls[0].init.body, 'data=' + encodeURIComponent(buildQuery(points, 500, 25)));

    assert.equal(result.ok, true);
    assert.equal(result.sampled, 4);
    assert.equal(result.matched, 4);
    assert.equal(result.coverage, 1);
    assert.equal(result.unknownShare, 0);
    const sum = VOICES.reduce((acc, v) => acc + result.mix[v], 0);
    assert.ok(Math.abs(sum - 100) < 1e-9, `mix sums to ${sum}`);
    assert.equal(result.mix.tarmac, 50);
    assert.equal(result.mix.mud, 50);
    assert.deepEqual(result.samples.map(s => s.voice), ['tarmac', 'tarmac', 'mud', 'mud']);
    assert.equal(result.samples[0].km, 0);
    assert.ok(Math.abs(result.samples[3].km - 1.5) < 1e-6);
});

test('a failed fetch returns ok:false with a reason', async () => {
    const points = straightTrack(1000, 100);

    const network = await fetchSurfaceMix(points, {
        fetch: async () => { throw new Error('offline'); }
    });
    assert.deepEqual(network, { ok: false, reason: 'network' });

    const http = await fetchSurfaceMix(points, {
        fetch: async () => ({ ok: false, status: 500, json: async () => ({}) })
    });
    assert.deepEqual(http, { ok: false, reason: 'http-500' });

    const empty = await fetchSurfaceMix(points, {
        fetch: async () => okResponse([])
    });
    assert.deepEqual(empty, { ok: false, reason: 'empty' });
});

test('a request that outlives timeoutMs fails with reason timeout', async () => {
    const stalled = (url, init) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('stalled')), 3000);
        if (init && init.signal) {
            init.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
            });
        }
    });
    const result = await fetchSurfaceMix(straightTrack(1000, 100), {
        fetch: stalled,
        timeoutMs: 30
    });
    assert.deepEqual(result, { ok: false, reason: 'timeout' });
});

test('HTTP 429 is retried at most twice, and a later success is used', async () => {
    const points = straightTrack(1000, 100);
    const way = {
        type: 'way',
        id: 1,
        tags: { surface: 'asphalt' },
        geometry: [{ lat: 45, lon: 10 }, { lat: 45.02, lon: 10 }]
    };
    let calls = 0;
    const result = await fetchSurfaceMix(points, {
        retryDelayMs: 0,
        fetch: async () => {
            calls++;
            return calls < 3
                ? { ok: false, status: 429, json: async () => ({}) }
                : okResponse([way]);
        }
    });
    assert.equal(calls, 3);
    assert.equal(result.ok, true);
    assert.equal(result.matched > 0, true);
});

test('a permanently throttled request gives up after three calls', async () => {
    let calls = 0;
    const result = await fetchSurfaceMix(straightTrack(1000, 100), {
        retryDelayMs: 0,
        fetch: async () => {
            calls++;
            return { ok: false, status: 429, json: async () => ({}) };
        }
    });
    assert.deepEqual(result, { ok: false, reason: 'http-429' });
    assert.equal(calls, 3);
});

test('the global fetch is used when no override is supplied', async () => {
    const original = globalThis.fetch;
    let seen = null;
    globalThis.fetch = async (url, init) => {
        seen = { url, init };
        return okResponse([{
            type: 'way',
            id: 1,
            tags: { surface: 'ground' },
            geometry: [{ lat: 45, lon: 10 }, { lat: 45.01, lon: 10 }]
        }]);
    };
    try {
        const result = await fetchSurfaceMix(straightTrack(500, 100));
        assert.equal(result.ok, true);
        assert.equal(result.matched > 0, true);
        assert.equal(seen.url, 'https://overpass-api.de/api/interpreter');
        assert.equal(seen.init.method, 'POST');
    } finally {
        globalThis.fetch = original;
    }
});
