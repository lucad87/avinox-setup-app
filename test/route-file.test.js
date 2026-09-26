const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeGradeStats, computeGradeProfile } = require('../public/route-file.js');

const METRES_PER_DEGREE = 111194.93;

/** Points along a meridian; `legs` = [{ lengthM, grade (%), stepM }]. */
function track(legs, noise = () => 0) {
    const points = [];
    let distance = 0;
    let elevation = 300;
    points.push({ lat: 45, lon: 10, ele: elevation, segmentId: 0 });
    legs.forEach((leg) => {
        for (let d = leg.stepM; d <= leg.lengthM + 1e-9; d += leg.stepM) {
            distance += leg.stepM;
            elevation += leg.stepM * leg.grade / 100;
            points.push({ lat: 45 + distance / METRES_PER_DEGREE, lon: 10, ele: elevation + noise(), segmentId: 0 });
        }
    });
    return points;
}

/* Deterministic GPS-like noise, uniform in ±amplitude. */
function noiseOf(amplitude, seed = 7) {
    let x = seed;
    return () => {
        x = (x * 1103515245 + 12345) % 2147483648;
        return (x / 2147483648 * 2 - 1) * amplitude;
    };
}

test('elevation noise on a steady 10% climb does not turn it steep', () => {
    const points = track([{ lengthM: 2000, grade: 10, stepM: 5 }], noiseOf(1.5));
    const g = computeGradeStats(points);
    const steep = g.distribution.steep + g.distribution.extreme;
    assert.ok(steep < 10, `steep + extreme = ${steep.toFixed(1)}%`);
    assert.ok(g.distribution.climb > 75, `climb = ${g.distribution.climb.toFixed(1)}%`);
});

test('a short flat stretch does not split a climb in two', () => {
    const g = computeGradeStats(track([
        { lengthM: 1000, grade: 8, stepM: 5 },
        { lengthM: 50, grade: 0, stepM: 5 },
        { lengthM: 1000, grade: 8, stepM: 5 }
    ]));
    assert.equal(g.climbs.length, 1);
    assert.ok(Math.abs(g.climbs[0].averageGrade - 160 / 2050 * 100) < 0.3, `${g.climbs[0].averageGrade}`);
});

test('a long flat stretch does end the climb', () => {
    const g = computeGradeStats(track([
        { lengthM: 1000, grade: 8, stepM: 5 },
        { lengthM: 500, grade: 0, stepM: 5 },
        { lengthM: 1000, grade: 8, stepM: 5 }
    ]));
    assert.equal(g.climbs.length, 2);
});

test('the average grade of a climb is its gain over its length', () => {
    // Dense fixes on the gentle part, sparse ones on the steep part.
    const g = computeGradeStats(track([
        { lengthM: 300, grade: 4, stepM: 5 },
        { lengthM: 600, grade: 12, stepM: 100 }
    ]));
    assert.equal(g.climbs.length, 1);
    const expected = (0.04 * 300 + 0.12 * 600) / 900 * 100;
    assert.ok(Math.abs(g.climbs[0].averageGrade - expected) < 0.3, `${g.climbs[0].averageGrade} vs ${expected}`);
});

test('a sparse route keeps its grades', () => {
    const g = computeGradeStats(track([{ lengthM: 3000, grade: 6, stepM: 500 }]));
    assert.equal(g.climbs.length, 1);
    assert.ok(Math.abs(g.climbs[0].averageGrade - 6) < 0.1);
    assert.ok(g.distribution.rolling > 99);
});

test('a flat route has no climbs', () => {
    const g = computeGradeStats(track([{ lengthM: 5000, grade: 0, stepM: 10 }]));
    assert.equal(g.climbs.length, 0);
    assert.ok(g.distribution.flat > 99);
});

test('the map colours and the grade bars come from the same measurement', () => {
    const points = track([
        { lengthM: 800, grade: 14, stepM: 5 },
        { lengthM: 800, grade: -6, stepM: 5 },
        { lengthM: 800, grade: 2, stepM: 5 }
    ], noiseOf(1.5, 3));
    const stats = computeGradeStats(points);
    const profile = computeGradeProfile(points);
    for (const band of Object.keys(stats.distributionMeters)) {
        assert.ok(Math.abs(stats.distributionMeters[band] - profile.meters[band]) < 1e-6, band);
    }
});
