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
        var batteryStart = null;
        var batteryEnd = null;

        for (var i = 0; i < timed.length; i++) {
            var s = timed[i];
            motorWh += (s.motorPower || 0) * sampleIntervalS(s, i > 0 ? timed[i - 1] : null) / 3600;
            if (s.battery != null) {
                if (batteryStart === null) batteryStart = s.battery;
                batteryEnd = s.battery;
            }
        }

        var last = timed[timed.length - 1] || {};
        return {
            samples: timed.length,
            motorWh: motorWh,
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

    return {
        sampleIntervalS: sampleIntervalS,
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
