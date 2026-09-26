/**
 * Energy of recorded rides — motor energy and pack efficiency.
 *
 * A recording logs the MOTOR power (mechanical output: rider + motor = total)
 * and the battery percentage. The route model works in PACK energy, so the
 * two are tied together here: the efficiency is the motor energy over the
 * energy the battery drop says was taken from the pack.
 *
 * Runs in the browser and under Node (tests), like route-file.js.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AvinoxRideEnergy = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // A longer silence between samples is a pause, not riding at that power.
    var MAX_SAMPLE_INTERVAL_S = 10;

    // Under this drop a 1 % step of the battery gauge is too coarse to measure.
    var MIN_BATTERY_DROP_PCT = 15;

    /* A ride outside this window is not a measurement of assisted riding: the
       motor barely ran, or the reading is off. The lower bound is the one the
       server applies to the personal factor (src/energy-model.ts); a test
       keeps the two equal. */
    var PLAUSIBLE_WH_PER_KM_MIN = 2.5;
    var PLAUSIBLE_WH_PER_KM_MAX = 50;

    var EFFICIENCY_DEFAULT = 0.8;
    var EFFICIENCY_MIN = 0.6;
    var EFFICIENCY_MAX = 0.95;

    function sampleIntervalS(sample, previous) {
        if (!previous || !(sample.timestamp > previous.timestamp)) return 1;
        return Math.min(sample.timestamp - previous.timestamp, MAX_SAMPLE_INTERVAL_S);
    }

    /** Motor energy, distance and battery gauge of a single ride. */
    function rideEnergy(samples) {
        var timed = (samples || []).filter(function (s) { return s && s.timestamp; });
        var motorWh = 0;
        var riderWh = 0;
        var batteryStart = null;
        var batteryEnd = null;

        for (var i = 0; i < timed.length; i++) {
            var s = timed[i];
            var dt = sampleIntervalS(s, i > 0 ? timed[i - 1] : null);
            motorWh += (s.motorPower || 0) * dt / 3600;
            riderWh += (s.riderPower || 0) * dt / 3600;
            if (s.battery != null) {
                if (batteryStart === null) batteryStart = s.battery;
                batteryEnd = s.battery;
            }
        }

        var last = timed[timed.length - 1] || {};
        return {
            samples: timed.length,
            motorWh: motorWh,
            riderWh: riderWh,
            km: last.distanceKm || 0,
            batteryStart: batteryStart,
            batteryEnd: batteryEnd
        };
    }

    /**
     * Pack efficiency over a set of rides: the motor energy of the rides whose
     * battery went down, over the pack energy that drop represents. Falls back
     * to the default, and says why, when the drop is too small to read or the
     * result is outside what a drive can do (a range extender, or a pack other
     * than the one selected).
     */
    function packEfficiency(rides, batteryWh) {
        var motorWh = 0;
        var dropPct = 0;
        (rides || []).forEach(function (r) {
            if (r.batteryStart != null && r.batteryEnd != null && r.batteryStart > r.batteryEnd) {
                motorWh += r.motorWh;
                dropPct += r.batteryStart - r.batteryEnd;
            }
        });

        var fallback = function (reason, value) {
            return { efficiency: EFFICIENCY_DEFAULT, measured: false, reason: reason, value: value, dropPct: dropPct };
        };
        if (!(batteryWh > 0)) return fallback('no-battery-capacity', null);
        if (dropPct < MIN_BATTERY_DROP_PCT) return fallback('battery-drop-too-small', null);

        var value = motorWh / (dropPct / 100 * batteryWh);
        if (!(value >= EFFICIENCY_MIN && value <= EFFICIENCY_MAX)) return fallback('out-of-range', value);
        return { efficiency: Math.round(value * 1000) / 1000, measured: true, reason: null, value: value, dropPct: dropPct };
    }

    /* ---------------------------------------------------------------- *
     * Assist values
     * A recording stores a number per sample for the assist in use. It is
     * not the mode's name: on a real ride 1 was ECO, 4 was AUTO and 20/21
     * were two custom modes. So each value is described by what the motor
     * did — the motor/rider ratio while pedalling, per gradient — and named
     * only where that is confirmed.
     * ---------------------------------------------------------------- */

    var KNOWN_ASSIST_NAMES = { 1: 'ECO', 4: 'AUTO' };
    var FIRST_CUSTOM_ASSIST = 20;
    var PEDALLING_W = 60;
    var GRADE_LOOKAHEAD_M = 50;
    var GRADE_BANDS = [[-Infinity, 3], [3, 7], [7, 12], [12, 18], [18, Infinity]];
    var MIN_SAMPLES = 30;
    var MIN_BAND_SAMPLES = 15;
    // A ratio that moves more than this across gradients is a dynamic mode.
    var DYNAMIC_SPREAD = 0.15;

    function median(values) {
        if (!values.length) return null;
        var sorted = values.slice().sort(function (a, b) { return a - b; });
        return sorted[Math.floor(sorted.length / 2)];
    }

    /* Grade ahead of each sample, over ~50 m of odometer distance. A
       distance that goes back (the next ride of a merged set) ends the
       lookahead. */
    function sampleGrades(samples) {
        var out = new Array(samples.length);
        for (var i = 0; i < samples.length; i++) {
            out[i] = null;
            var a = samples[i];
            if (!Number.isFinite(a.altitude)) continue;
            for (var j = i + 1; j < samples.length; j++) {
                if (samples[j].distanceKm < samples[j - 1].distanceKm) break;
                var metres = (samples[j].distanceKm - a.distanceKm) * 1000;
                if (metres < GRADE_LOOKAHEAD_M) continue;
                if (metres < 4 * GRADE_LOOKAHEAD_M && Number.isFinite(samples[j].altitude)) {
                    out[i] = (samples[j].altitude - a.altitude) / metres * 100;
                }
                break;
            }
        }
        return out;
    }

    function assistName(value) {
        if (KNOWN_ASSIST_NAMES[value]) return KNOWN_ASSIST_NAMES[value];
        return value >= FIRST_CUSTOM_ASSIST ? 'custom' : null;
    }

    function ratioText(r) {
        return (Math.round(r * 10) / 10).toFixed(1) + '×';
    }

    /**
     * One entry per assist value: how the motor behaved, and a label such as
     * "ECO · fixed 1.2×" or "assist 3 · dynamic 2.3–3.6×".
     */
    function describeAssistValues(samples) {
        var timed = (samples || []).filter(function (s) { return s && s.timestamp; });
        var grades = sampleGrades(timed);
        var byValue = {};

        timed.forEach(function (s, i) {
            if (s.assist == null) return;
            var v = byValue[s.assist] || (byValue[s.assist] = { ratios: [], bands: GRADE_BANDS.map(function () { return []; }), maxMotorW: 0 });
            v.maxMotorW = Math.max(v.maxMotorW, s.motorPower || 0);
            if (!((s.riderPower || 0) > PEDALLING_W)) return;
            var ratio = (s.motorPower || 0) / s.riderPower;
            v.ratios.push(ratio);
            if (grades[i] == null) return;
            for (var b = 0; b < GRADE_BANDS.length; b++) {
                if (grades[i] >= GRADE_BANDS[b][0] && grades[i] < GRADE_BANDS[b][1]) { v.bands[b].push(ratio); break; }
            }
        });

        return Object.keys(byValue).map(Number).sort(function (a, b) { return a - b; }).map(function (value) {
            var v = byValue[value];
            var name = assistName(value);
            var out = { value: value, name: name, maxMotorW: Math.round(v.maxMotorW), behaviour: 'brief', ratio: null, ratioMin: null, ratioMax: null };
            var overall = median(v.ratios);
            if (v.ratios.length >= MIN_SAMPLES && overall != null) {
                var bandMedians = v.bands.filter(function (b) { return b.length >= MIN_BAND_SAMPLES; }).map(median);
                var lo = bandMedians.length ? Math.min.apply(null, bandMedians) : overall;
                var hi = bandMedians.length ? Math.max.apply(null, bandMedians) : overall;
                out.ratio = overall;
                out.ratioMin = lo;
                out.ratioMax = hi;
                if (overall < 0.1) out.behaviour = 'none';
                else out.behaviour = bandMedians.length >= 2 && (hi - lo) / overall > DYNAMIC_SPREAD ? 'dynamic' : 'fixed';
            }
            var how = {
                brief: 'too brief to read',
                none: 'no assist',
                fixed: out.ratio != null ? 'fixed ' + ratioText(out.ratio) : '',
                dynamic: out.ratio != null ? 'dynamic ' + ratioText(out.ratioMin) + '–' + ratioText(out.ratioMax) : ''
            }[out.behaviour];
            var title = name === 'custom' ? 'custom ' + value : (name || 'assist ' + value);
            out.label = title + ' · ' + how;
            return out;
        });
    }

    return {
        sampleIntervalS: sampleIntervalS,
        describeAssistValues: describeAssistValues,
        assistName: assistName,
        rideEnergy: rideEnergy,
        packEfficiency: packEfficiency,
        constants: {
            MAX_SAMPLE_INTERVAL_S: MAX_SAMPLE_INTERVAL_S,
            MIN_BATTERY_DROP_PCT: MIN_BATTERY_DROP_PCT,
            PLAUSIBLE_WH_PER_KM_MIN: PLAUSIBLE_WH_PER_KM_MIN,
            PLAUSIBLE_WH_PER_KM_MAX: PLAUSIBLE_WH_PER_KM_MAX,
            EFFICIENCY_DEFAULT: EFFICIENCY_DEFAULT,
            EFFICIENCY_MIN: EFFICIENCY_MIN,
            EFFICIENCY_MAX: EFFICIENCY_MAX
        }
    };
});
