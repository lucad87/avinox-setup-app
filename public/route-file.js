/**
 * Route file import — GPX and KML parsing, normalisation and statistics.
 *
 * Everything in this file runs in the browser. Route coordinates never leave
 * the device: only the aggregate figures (distance, elevation gain) are sent
 * to the backend by the caller.
 *
 * Both formats are normalised into the same shape so that everything
 * downstream (distance, elevation, and later grade analysis and custom mode
 * proposals) is format-agnostic:
 *
 *     GPX ─┐
 *          ├─> geometries ─> NormalizedRoute ─> stats
 *     KML ─┘
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AvinoxRoute = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var EARTH_R_M = 6371000;

    // Tuning constants — all in one place.
    var MIN_POINT_SEPARATION_M = 0.5;   // below this, two fixes are the same point
    var GAP_WARNING_M = 1000;           // a jump this large is flagged
    var ELEVATION_SMOOTH_WINDOW = 5;    // moving average over N points
    var ELEVATION_THRESHOLD_M = 3;      // hysteresis before counting gain/loss
    var NOISY_GAIN_RATIO = 1.5;         // raw/smoothed gain above this = noisy
    var MAX_POINTS = 100000;

    /* ------------------------------------------------------------------ *
     * Geometry helpers
     * ------------------------------------------------------------------ */

    function toRad(deg) {
        return (deg * Math.PI) / 180;
    }

    /** Great-circle distance in metres between two {lat, lon} points. */
    function haversine(a, b) {
        var dLat = toRad(b.lat - a.lat);
        var dLon = toRad(b.lon - a.lon);
        var la1 = toRad(a.lat);
        var la2 = toRad(b.lat);
        var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    /** Rejects non-numeric, out-of-range and "null island" (0,0) coordinates. */
    function isValidCoord(lat, lon) {
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
        if (lat === 0 && lon === 0) return false;
        return true;
    }

    /* ------------------------------------------------------------------ *
     * Cleaning
     * ------------------------------------------------------------------ */

    /**
     * Drops invalid coordinates and consecutive duplicates, and counts large
     * jumps. Gaps are reported but their distance is still included: a sparse
     * route file legitimately has long legs, and silently removing them would
     * under-report the route.
     */
    function cleanPoints(points) {
        var out = [];
        var droppedInvalid = 0;
        var droppedDuplicate = 0;
        var gaps = 0;

        for (var i = 0; i < points.length; i++) {
            var p = points[i];
            if (!isValidCoord(p.lat, p.lon)) {
                droppedInvalid++;
                continue;
            }
            if (out.length > 0) {
                var prev = out[out.length - 1];
                var sameSegment = prev.segmentId === p.segmentId;
                var d = haversine(prev, p);
                if (sameSegment && d < MIN_POINT_SEPARATION_M) {
                    droppedDuplicate++;
                    continue;
                }
                if (sameSegment && d > GAP_WARNING_M) {
                    gaps++;
                }
            }
            out.push(p);
        }

        return {
            points: out,
            droppedInvalid: droppedInvalid,
            droppedDuplicate: droppedDuplicate,
            gaps: gaps
        };
    }

    /* ------------------------------------------------------------------ *
     * Elevation
     * ------------------------------------------------------------------ */

    /** Moving average. Returns a new array; nulls are carried through. */
    function smoothElevations(values, window) {
        var w = Math.max(1, Math.floor(window) || 1);
        if (w === 1) return values.slice();
        var half = Math.floor(w / 2);
        var out = new Array(values.length);

        for (var i = 0; i < values.length; i++) {
            if (values[i] === null) { out[i] = null; continue; }
            var sum = 0;
            var n = 0;
            for (var j = i - half; j <= i + half; j++) {
                if (j >= 0 && j < values.length && values[j] !== null) {
                    sum += values[j];
                    n++;
                }
            }
            out[i] = n > 0 ? sum / n : null;
        }
        return out;
    }

    /**
     * Accumulates gain and loss with hysteresis: the running total only moves
     * once the elevation has drifted past `threshold` from the last anchor.
     * Without this, GPS noise turns a 1000 m climb into 1500 m.
     */
    function elevationGainLoss(values, threshold) {
        var usable = values.filter(function (v) { return v !== null; });
        if (usable.length < 2) return { gain: 0, loss: 0 };

        var gain = 0;
        var loss = 0;
        var anchor = usable[0];

        for (var i = 1; i < usable.length; i++) {
            var diff = usable[i] - anchor;
            if (diff >= threshold) {
                gain += diff;
                anchor = usable[i];
            } else if (diff <= -threshold) {
                loss += -diff;
                anchor = usable[i];
            }
        }
        return { gain: gain, loss: loss };
    }

    /** 'available' | 'zero' (present but flat) | 'missing' */
    function elevationStatus(values) {
        var present = values.filter(function (v) { return v !== null; });
        if (present.length === 0) return 'missing';
        var allZero = present.every(function (v) { return v === 0; });
        return allZero ? 'zero' : 'available';
    }

    /* ------------------------------------------------------------------ *
     * Statistics
     * ------------------------------------------------------------------ */

    /**
     * Computes distance and elevation figures for a normalised route.
     * Distance is only accumulated within a segment, so two separate
     * geometries are never joined by an artificial straight line.
     */
    function computeStats(points) {
        var cleaned = cleanPoints(points);
        var pts = cleaned.points;
        var warnings = [];

        if (pts.length < 2) {
            return {
                ok: false,
                error: 'Not enough valid points to build a route.',
                warnings: warnings
            };
        }

        var distanceM = 0;
        for (var i = 1; i < pts.length; i++) {
            if (pts[i].segmentId === pts[i - 1].segmentId) {
                distanceM += haversine(pts[i - 1], pts[i]);
            }
        }

        var raw = pts.map(function (p) {
            return Number.isFinite(p.ele) ? p.ele : null;
        });
        var status = elevationStatus(raw);

        // Never smooth harder than the data supports. A fixed window of 5 on a
        // short track would average the whole climb away (100/150/200 becomes
        // 150/150/150 and reports zero gain), so the window scales with length.
        var window = Math.max(1, Math.min(ELEVATION_SMOOTH_WINDOW, Math.floor(raw.length / 4)));
        var smoothed = status === 'available'
            ? smoothElevations(raw, window)
            : raw;

        var smoothedTotals = status === 'available'
            ? elevationGainLoss(smoothed, ELEVATION_THRESHOLD_M)
            : { gain: 0, loss: 0 };
        var rawTotals = status === 'available'
            ? elevationGainLoss(raw, ELEVATION_THRESHOLD_M)
            : { gain: 0, loss: 0 };

        var present = raw.filter(function (v) { return v !== null; });
        var minEle = present.length ? Math.min.apply(null, present) : null;
        var maxEle = present.length ? Math.max.apply(null, present) : null;

        var quality = 'good';
        if (status !== 'available') {
            quality = 'unavailable';
        } else if (rawTotals.gain > 0 &&
            (smoothedTotals.gain <= 0 ||
                rawTotals.gain / smoothedTotals.gain > NOISY_GAIN_RATIO)) {
            // A raw gain that smoothing erases completely is noise by definition.
            quality = 'noisy';
        }

        var segments = {};
        pts.forEach(function (p) { segments[p.segmentId] = true; });

        if (cleaned.droppedInvalid > 0) {
            warnings.push(cleaned.droppedInvalid + ' point(s) had invalid coordinates and were dropped.');
        }
        if (cleaned.droppedDuplicate > 0) {
            warnings.push(cleaned.droppedDuplicate + ' duplicate point(s) were merged.');
        }
        if (cleaned.gaps > 0) {
            warnings.push(cleaned.gaps + ' gap(s) larger than ' + (GAP_WARNING_M / 1000) +
                ' km were found: distance may be approximate.');
        }
        if (status === 'missing') {
            warnings.push('This file contains no elevation data: enter the elevation gain manually.');
        }
        if (status === 'zero') {
            warnings.push('Elevation is present but always zero (clampToGround): elevation gain cannot be derived.');
        }
        if (quality === 'noisy') {
            warnings.push('Elevation data looks noisy: the gain figure has been smoothed.');
        }
        if (pts.length >= MAX_POINTS) {
            warnings.push('Very large file: only the first ' + MAX_POINTS + ' points were analysed.');
        }

        return {
            ok: true,
            pointCount: pts.length,
            segmentCount: Object.keys(segments).length,
            distanceKm: distanceM / 1000,
            elevationStatus: status,
            smoothingWindow: window,
            elevationGainM: smoothedTotals.gain,
            elevationLossM: smoothedTotals.loss,
            rawGainM: rawTotals.gain,
            minElevationM: minEle,
            maxElevationM: maxEle,
            quality: quality,
            warnings: warnings
        };
    }

    /* ------------------------------------------------------------------ *
     * Grade analysis (Phase 2)
     * ------------------------------------------------------------------ */

    // Grade is measured over a distance window, never between two adjacent
    // fixes: a 5 m pair would produce wild percentages.
    var GRADE_WINDOW_M = 25;
    var CLIMB_MIN_GRADE = 3;        // % needed to count as climbing
    var CLIMB_MIN_GAIN_M = 30;      // m of gain for a climb to be reported
    var CLIMB_MIN_LENGTH_M = 300;   // m of length for a climb to be reported

    var GRADE_BANDS = [
        { key: 'descent', label: 'Descent', max: -2 },
        { key: 'flat', label: 'Flat', max: 3 },
        { key: 'rolling', label: 'Rolling', max: 7 },
        { key: 'climb', label: 'Climb', max: 12 },
        { key: 'steep', label: 'Steep', max: 18 },
        { key: 'extreme', label: 'Extreme', max: Infinity }
    ];

    function bandForGrade(grade) {
        for (var i = 0; i < GRADE_BANDS.length; i++) {
            if (grade < GRADE_BANDS[i].max) return GRADE_BANDS[i].key;
        }
        return GRADE_BANDS[GRADE_BANDS.length - 1].key;
    }

    function finaliseClimb(current) {
        var sum = current.grades.reduce(function (a, b) { return a + b; }, 0);
        return {
            distanceM: current.distanceM,
            gainM: current.gainM,
            averageGrade: current.grades.length ? sum / current.grades.length : 0,
            maxGrade: current.maxGrade
        };
    }

    /** Groups consecutive climbing samples into named climbs. */
    function detectClimbs(samples) {
        var found = [];
        var current = null;

        samples.forEach(function (s) {
            if (s.grade >= CLIMB_MIN_GRADE) {
                if (!current) {
                    current = { distanceM: 0, gainM: 0, maxGrade: s.grade, grades: [] };
                }
                current.distanceM += s.distanceM;
                current.gainM += s.gainM;
                current.maxGrade = Math.max(current.maxGrade, s.grade);
                current.grades.push(s.grade);
            } else if (current) {
                found.push(finaliseClimb(current));
                current = null;
            }
        });
        if (current) found.push(finaliseClimb(current));

        return found
            .filter(function (c) {
                return c.gainM >= CLIMB_MIN_GAIN_M && c.distanceM >= CLIMB_MIN_LENGTH_M;
            })
            .map(function (c, i) {
                return {
                    index: i + 1,
                    distanceKm: c.distanceM / 1000,
                    gainM: c.gainM,
                    averageGrade: c.averageGrade,
                    maxGrade: c.maxGrade
                };
            });
    }

    /**
     * Grade distribution by distance, plus the climbs found along the way.
     * Returns { ok: false, reason } when elevation is unusable.
     */
    function computeGradeStats(points) {
        var elevations = points.map(function (p) {
            return Number.isFinite(p.ele) ? p.ele : null;
        });
        var status = elevationStatus(elevations);
        if (status !== 'available') return { ok: false, reason: 'elevation-' + status };
        if (points.length < 3) return { ok: false, reason: 'too-few-points' };

        var samples = [];
        var accDistance = 0;
        var startEle = null;

        for (var i = 1; i < points.length; i++) {
            var a = points[i - 1];
            var b = points[i];

            // A new segment restarts the window: never bridge a discontinuity.
            if (a.segmentId !== b.segmentId) {
                accDistance = 0;
                startEle = null;
                continue;
            }
            if (!Number.isFinite(a.ele) || !Number.isFinite(b.ele)) continue;

            var d = haversine(a, b);
            if (d <= 0) continue;

            if (startEle === null) startEle = a.ele;
            accDistance += d;

            if (accDistance >= GRADE_WINDOW_M) {
                var delta = b.ele - startEle;
                samples.push({
                    grade: (delta / accDistance) * 100,
                    distanceM: accDistance,
                    gainM: delta
                });
                accDistance = 0;
                startEle = b.ele;
            }
        }

        // Flush the trailing remainder if it is meaningful.
        if (accDistance > 5 && startEle !== null) {
            var last = points[points.length - 1];
            var tailDelta = last.ele - startEle;
            samples.push({
                grade: (tailDelta / accDistance) * 100,
                distanceM: accDistance,
                gainM: tailDelta
            });
        }

        if (samples.length === 0) return { ok: false, reason: 'too-short' };

        var totalDistance = samples.reduce(function (s, x) { return s + x.distanceM; }, 0);
        var meters = {};
        GRADE_BANDS.forEach(function (b) { meters[b.key] = 0; });
        samples.forEach(function (s) { meters[bandForGrade(s.grade)] += s.distanceM; });

        var percent = {};
        GRADE_BANDS.forEach(function (b) {
            percent[b.key] = totalDistance > 0 ? (meters[b.key] / totalDistance) * 100 : 0;
        });

        var climbs = detectClimbs(samples);
        var grades = climbs.map(function (c) { return c.averageGrade; }).sort(function (a, b) { return a - b; });
        var medianGrade = grades.length
            ? (grades.length % 2
                ? grades[(grades.length - 1) / 2]
                : (grades[grades.length / 2 - 1] + grades[grades.length / 2]) / 2)
            : 0;

        return {
            ok: true,
            windowM: GRADE_WINDOW_M,
            sampleCount: samples.length,
            distribution: percent,
            distributionMeters: meters,
            maxGrade: samples.reduce(function (m, s) { return Math.max(m, s.grade); }, -Infinity),
            climbs: climbs,
            climbSummary: {
                count: climbs.length,
                medianGrade: medianGrade,
                longestKm: climbs.reduce(function (m, c) { return Math.max(m, c.distanceKm); }, 0),
                totalGainM: climbs.reduce(function (s, c) { return s + c.gainM; }, 0),
                steepShare: percent.steep + percent.extreme
            }
        };
    }

    /* ------------------------------------------------------------------ *
     * XML helpers
     * ------------------------------------------------------------------ */

    function byLocalName(node, localName) {
        return Array.prototype.slice.call(node.getElementsByTagNameNS('*', localName));
    }

    function directChildText(el, localName) {
        if (!el.children) return null;
        for (var i = 0; i < el.children.length; i++) {
            var c = el.children[i];
            if (c.localName === localName) return (c.textContent || '').trim();
        }
        return null;
    }

    function parseXml(text) {
        if (typeof DOMParser === 'undefined') {
            throw new Error('XML parsing is only available in the browser.');
        }
        var doc = new DOMParser().parseFromString(text, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length > 0) {
            throw new Error('The file is not valid XML.');
        }
        return doc;
    }

    function pointFromGpxElement(el) {
        var lat = parseFloat(el.getAttribute('lat'));
        var lon = parseFloat(el.getAttribute('lon'));
        var eleText = directChildText(el, 'ele');
        var timeText = directChildText(el, 'time');
        var ele = eleText !== null ? parseFloat(eleText) : NaN;
        return {
            lat: lat,
            lon: lon,
            ele: Number.isFinite(ele) ? ele : null,
            time: timeText || null
        };
    }

    /* ------------------------------------------------------------------ *
     * GPX
     * ------------------------------------------------------------------ */

    function parseGpx(text) {
        var doc = parseXml(text);
        var geometries = [];
        var warnings = [];

        // Tracks: one geometry per <trkseg>.
        byLocalName(doc, 'trk').forEach(function (trk, ti) {
            var name = directChildText(trk, 'name') || ('Track ' + (ti + 1));
            var segs = byLocalName(trk, 'trkseg');
            segs.forEach(function (seg, si) {
                var points = byLocalName(seg, 'trkpt').map(pointFromGpxElement);
                if (points.length >= 2) {
                    geometries.push({
                        name: segs.length > 1 ? name + ' (segment ' + (si + 1) + ')' : name,
                        points: points,
                        sparse: false
                    });
                }
            });
        });

        // Routes: <rte> is a list of waypoints, often sparse.
        byLocalName(doc, 'rte').forEach(function (rte, ri) {
            var name = directChildText(rte, 'name') || ('Route ' + (ri + 1));
            var points = byLocalName(rte, 'rtept').map(pointFromGpxElement);
            if (points.length >= 2) {
                geometries.push({ name: name, points: points, sparse: true });
            }
        });

        if (geometries.length === 0) {
            if (byLocalName(doc, 'wpt').length > 0) {
                warnings.push('Only waypoints were found: a GPX track or route is required.');
            } else {
                warnings.push('No track or route found in this GPX file.');
            }
        }

        return { source: 'gpx', geometries: geometries, warnings: warnings };
    }

    /* ------------------------------------------------------------------ *
     * KML
     * ------------------------------------------------------------------ */

    /** KML coordinates are "lon,lat[,alt]" — note lon comes FIRST. */
    function parseKmlCoordinateText(text) {
        if (!text) return [];
        var out = [];
        text.trim().split(/\s+/).forEach(function (token) {
            var parts = token.split(',');
            if (parts.length < 2) return;
            var lon = parseFloat(parts[0]);
            var lat = parseFloat(parts[1]);
            var ele = parts.length > 2 ? parseFloat(parts[2]) : NaN;
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                out.push({
                    lat: lat,
                    lon: lon,
                    ele: Number.isFinite(ele) ? ele : null,
                    time: null
                });
            }
        });
        return out;
    }

    /** gx:Track — gx:coord holds "lon lat alt", gx:when holds the times. */
    function parseGxTrack(track) {
        var coords = byLocalName(track, 'coord');
        var whens = byLocalName(track, 'when');
        var out = [];
        coords.forEach(function (c, i) {
            var parts = (c.textContent || '').trim().split(/\s+/);
            if (parts.length < 2) return;
            var lon = parseFloat(parts[0]);
            var lat = parseFloat(parts[1]);
            var ele = parts.length > 2 ? parseFloat(parts[2]) : NaN;
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                out.push({
                    lat: lat,
                    lon: lon,
                    ele: Number.isFinite(ele) ? ele : null,
                    time: whens[i] ? (whens[i].textContent || '').trim() : null
                });
            }
        });
        return out;
    }

    function parseKml(text) {
        var doc = parseXml(text);
        var geometries = [];
        var warnings = [];
        var placemarks = byLocalName(doc, 'Placemark');
        var skippedPoints = 0;
        var skippedPolygons = 0;

        function addGeometry(name, points, kind) {
            if (points.length >= 2) {
                geometries.push({ name: name, points: points, sparse: kind === 'track' });
            }
        }

        placemarks.forEach(function (pm, pi) {
            var name = directChildText(pm, 'name') || ('Placemark ' + (pi + 1));

            byLocalName(pm, 'LineString').forEach(function (ls, li) {
                var coordsText = byLocalName(ls, 'coordinates')
                    .map(function (c) { return c.textContent; })
                    .join(' ');
                addGeometry(
                    byLocalName(pm, 'LineString').length > 1 ? name + ' (line ' + (li + 1) + ')' : name,
                    parseKmlCoordinateText(coordsText),
                    'line'
                );
            });

            byLocalName(pm, 'Track').forEach(function (tr, ti) {
                addGeometry(
                    byLocalName(pm, 'Track').length > 1 ? name + ' (track ' + (ti + 1) + ')' : name,
                    parseGxTrack(tr),
                    'track'
                );
            });

            skippedPoints += byLocalName(pm, 'Point').length;
            skippedPolygons += byLocalName(pm, 'Polygon').length;
        });

        // Geometries outside any Placemark (valid but unusual KML).
        if (geometries.length === 0) {
            byLocalName(doc, 'LineString').forEach(function (ls, li) {
                var coordsText = byLocalName(ls, 'coordinates')
                    .map(function (c) { return c.textContent; })
                    .join(' ');
                addGeometry('LineString ' + (li + 1), parseKmlCoordinateText(coordsText), 'line');
            });
        }

        if (geometries.length === 0) {
            if (skippedPoints > 0 || skippedPolygons > 0) {
                warnings.push('This KML contains only points or polygons: a LineString or gx:Track is required.');
            } else {
                warnings.push('No LineString or gx:Track found in this KML file.');
            }
        }
        if (skippedPoints > 0) {
            warnings.push(skippedPoints + ' point placemark(s) were ignored (not part of a track).');
        }
        if (skippedPolygons > 0) {
            warnings.push(skippedPolygons + ' polygon(s) were ignored (areas, not routes).');
        }
        if (geometries.length > 1) {
            warnings.push('This file contains ' + geometries.length +
                ' geometries. All are selected by default; uncheck any you do not want to include.');
        }

        return { source: 'kml', geometries: geometries, warnings: warnings };
    }

    /* ------------------------------------------------------------------ *
     * Entry points
     * ------------------------------------------------------------------ */

    /** Detects the format from the content, not from the file extension. */
    function detectFormat(text) {
        var head = text.slice(0, 4000);
        if (/<kml[\s>]/i.test(head) || /<gx:/i.test(head)) return 'kml';
        if (/<gpx[\s>]/i.test(head)) return 'gpx';
        // Fall back to root element inspection.
        var m = head.match(/<\??\s*([a-zA-Z0-9:]+)/);
        if (m && /kml/i.test(m[1])) return 'kml';
        if (m && /gpx/i.test(m[1])) return 'gpx';
        return null;
    }

    function parseRouteFile(text, filename) {
        var format = detectFormat(text);
        if (!format) {
            throw new Error('Unrecognised file: expected GPX or KML.');
        }
        var result = format === 'kml' ? parseKml(text) : parseGpx(text);
        result.filename = filename || null;
        return result;
    }

    /** Concatenates the selected geometries into one route with segment ids. */
    function buildRoute(geometries) {
        var points = [];
        geometries.forEach(function (geom, index) {
            geom.points.forEach(function (p) {
                points.push({
                    lat: p.lat,
                    lon: p.lon,
                    ele: p.ele,
                    time: p.time,
                    segmentId: index
                });
            });
        });
        return { points: points };
    }

    return {
        haversine: haversine,
        isValidCoord: isValidCoord,
        cleanPoints: cleanPoints,
        smoothElevations: smoothElevations,
        elevationGainLoss: elevationGainLoss,
        elevationStatus: elevationStatus,
        computeStats: computeStats,
        computeGradeStats: computeGradeStats,
        detectClimbs: detectClimbs,
        bandForGrade: bandForGrade,
        gradeBands: GRADE_BANDS,
        detectFormat: detectFormat,
        parseGpx: parseGpx,
        parseKml: parseKml,
        parseRouteFile: parseRouteFile,
        buildRoute: buildRoute,
        constants: {
            MIN_POINT_SEPARATION_M: MIN_POINT_SEPARATION_M,
            GAP_WARNING_M: GAP_WARNING_M,
            ELEVATION_SMOOTH_WINDOW: ELEVATION_SMOOTH_WINDOW,
            ELEVATION_THRESHOLD_M: ELEVATION_THRESHOLD_M,
            MAX_POINTS: MAX_POINTS,
            GRADE_WINDOW_M: GRADE_WINDOW_M,
            CLIMB_MIN_GRADE: CLIMB_MIN_GRADE,
            CLIMB_MIN_GAIN_M: CLIMB_MIN_GAIN_M,
            CLIMB_MIN_LENGTH_M: CLIMB_MIN_LENGTH_M
        }
    };
});
