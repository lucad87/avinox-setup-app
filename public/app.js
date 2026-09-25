let rangeChartInstance = null;
let runtimeChartInstance = null;
let missionPieChartInstance = null;
let stockChartInstance = null;

/* ---- Personal calibration (Phase 2A) ----------------------------------- */
/* A real ride (.proto) is parsed locally and compared against the model:   */
/* actual motor energy vs the energy the community table would predict for  */
/* the same rider input. The ratio becomes a personal factor applied to the */
/* runtime/range estimates (factor > 1 → the user's bike draws more than    */
/* the table predicts → estimates shrink).                                  */

const CALIBRATION_KEY = 'avinox-calibration';
let lastCalcRes = null;   // last /api/calculate response (before/after comparison)
const FORM_KEY = 'avinox-form';

function getCalibration() {
    try {
        const raw = localStorage.getItem(CALIBRATION_KEY);
        const c = raw ? JSON.parse(raw) : null;
        return (c && c.factor > 0 && c.factor < 5) ? c : null;
    } catch (e) { return null; }
}

function setCalibration(cal) {
    try {
        if (cal) localStorage.setItem(CALIBRATION_KEY, JSON.stringify(cal));
        else localStorage.removeItem(CALIBRATION_KEY);
    } catch (e) { /* ignore */ }
    renderCalibrationState();
}

function renderCalibrationState() {
    const badge = document.getElementById('calibrationBadge');
    if (!badge) return;
    const cal = getCalibration();
    const note = document.getElementById('calibrationNote');
    const tunerState = document.getElementById('tunerCalibrationState');
    const summary = document.getElementById('calibrationSummary');
    const emptyMsg = document.getElementById('calibrationEmpty');
    const insights = document.getElementById('rideInsights');
    const ridesCal = document.getElementById('ridesCalibration');

    const hasRides = loadedRides.length > 0;
    if (insights) insights.classList.toggle('hidden', !hasRides);
    if (ridesCal) ridesCal.classList.toggle('hidden', !(hasRides || !!cal));
    /* A calibration can outlive the rides it was measured on (it is stored
       on the device). When it does, the card stays on screen, without the
       step number, and says where the factor comes from. */
    if (ridesCal) {
        const standalone = !hasRides && !!cal;
        ridesCal.classList.toggle('standalone', standalone);
        const titleText = document.getElementById('calibrationTitleText');
        if (titleText) titleText.innerText = standalone ? 'Saved calibration' : 'Calibration';
        const standaloneNote = document.getElementById('calibrationStandaloneNote');
        if (standaloneNote) standaloneNote.classList.toggle('hidden', !standalone);
    }

    if (cal) {
        badge.classList.remove('hidden');
        badge.innerText = cal.whPerKm ? cal.whPerKm + ' Wh/km' : 'calibrated';
        if (tunerState) {
            tunerState.innerText = (cal.whPerKm ? cal.whPerKm + ' Wh/km · ' : '') + cal.rideLabel;
            tunerState.className = 'kv-value status-ok';
        }
        if (summary) summary.classList.remove('hidden');
        if (emptyMsg) emptyMsg.classList.add('hidden');
        const factorEl = document.getElementById('calibrationFactor');
        const sourceEl = document.getElementById('calibrationSource');
        if (factorEl) factorEl.innerText = cal.whPerKm ? cal.whPerKm + ' Wh/km' : '—';
        if (sourceEl) sourceEl.innerText = cal.rideLabel;
        if (note) {
            note.classList.remove('hidden');
            note.innerText = 'Range and runtime come from your rides: ' +
                (cal.whPerKm ?? '?') + ' Wh/km of motor energy, measured while riding at assist level ' +
                (cal.avgLevel ?? '?') + '. Estimates are projected per mode from that real consumption.';
        }
        const resetBtn = document.getElementById('calibrationReset');
        if (resetBtn && !resetBtn.dataset.wired) {
            resetBtn.dataset.wired = '1';
            resetBtn.addEventListener('click', () => {
                setCalibration(null);
                updateSetup(); // back to the model-based estimates
                /* The visible analysis was scaled by that factor: recompute
                   it, or the energy card would keep quoting a calibration
                   that no longer exists. */
                if (routeStats || loadedRides.length) {
                    document.getElementById('missionForm')
                        .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                }
            });
        }
    } else {
        badge.classList.add('hidden');
        if (tunerState) {
            tunerState.innerText = 'not calibrated';
            tunerState.className = 'kv-value';
        }
        if (summary) summary.classList.add('hidden');
        if (emptyMsg) emptyMsg.classList.remove('hidden');
        if (note) note.classList.add('hidden');
    }
}

/* ---- Route map (MapLibre): coloured track + cursor-synced marker ---- */

let rideMap = null;
let rideMapPoints = [];       // downsampled route points (with lat/lon)

const MAP_CHANNELS = {
    speed: { label: 'km/h', get: (s) => s.speed, ramp: ['#276bc1', '#e06432'], step: 0 },
    altitude: { label: 'm', get: (s) => s.altitude, ramp: ['#665d50', '#c9b18a'], step: 0 },
    gradient: { label: '%', get: (s) => s.gradient, ramp: ['#2b6cb0', '#c0392b'], step: 0, symmetric: true },
    riderPower: { label: 'W', get: (s) => s.riderPower, ramp: ['#f0c060', '#c0392b'], step: 0 },
    motorPower: { label: 'W', get: (s) => s.motorPower, ramp: ['#c9b6e8', '#5c4290'], step: 0 },
    cadence: { label: 'rpm', get: (s) => s.cadence, ramp: ['#9fd8c8', '#16a078'], step: 0 },
    gear: { label: '', get: (s) => s.gear, ramp: ['#cfd8d3', '#2d6655'], step: 0 },
    battery: { label: '%', get: (s) => s.battery, ramp: ['#e4462d', '#68a52f'], step: 0 },
    heartRate: { label: 'bpm', get: (s) => s.heartRate, ramp: ['#f2b3bd', '#ce3a4e'], step: 0 }
};

function buildRouteGeoJSON(samples, channelId) {
    const ch = MAP_CHANNELS[channelId] || MAP_CHANNELS.speed;
    const step = Math.max(1, Math.floor(samples.length / 600));
    const pts = [];
    for (let i = 0; i < samples.length; i += step) {
        const s = samples[i];
        if (Number.isFinite(s.latitude) && Number.isFinite(s.longitude)) pts.push(s);
    }
    rideMapPoints = pts;

    const values = pts.map((s) => ch.get(s)).filter((v) => Number.isFinite(v));
    let lo = values.length ? Math.min(...values) : 0;
    let hi = values.length ? Math.max(...values) : 1;
    if (ch.symmetric) {
        const m = Math.max(Math.abs(lo), Math.abs(hi), 1);
        lo = -m; hi = m;
    }
    if (hi - lo < 1e-6) hi = lo + 1;

    const features = [];
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const va = ch.get(a), vb = ch.get(b);
        const v = Number.isFinite(vb) ? vb : va;
        if (!Number.isFinite(v)) continue;
        features.push({
            type: 'Feature',
            /* i = index of this point in rideMapPoints: lets a map hover
               map back to the graph cursor. */
            properties: { v, i },
            geometry: { type: 'LineString', coordinates: [[a.longitude, a.latitude], [b.longitude, b.latitude]] }
        });
    }
    return { geojson: { type: 'FeatureCollection', features }, lo, hi, ch };
}

function buildRideMap(ride) {
    const el = document.getElementById('rideMap');
    if (!el || typeof maplibregl === 'undefined' || !ride) return;
    const channelId = document.getElementById('mapChannel').value;
    const { geojson, lo, hi, ch } = buildRouteGeoJSON(ride.samples, channelId);
    if (!rideMapPoints.length) return;

    const colorExpr = ['interpolate', ['linear'], ['get', 'v'], lo, ch.ramp[0], hi, ch.ramp[1]];

    /* Legend: min/max of the selected channel. */
    const legend = document.getElementById('mapLegend');
    if (legend) {
        legend.innerHTML =
            '<span class="legend-swatch" style="background:linear-gradient(90deg,' + ch.ramp[0] + ',' + ch.ramp[1] + ')"></span>' +
            '<span>' + Math.round(lo) + ' – ' + Math.round(hi) + ' ' + (ch.label || '') + '</span>';
    }

    if (!rideMap) {
        rideMap = new maplibregl.Map({
            container: el,
            style: {
                version: 8,
                sources: {
                    osm: {
                        type: 'raster',
                        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                        tileSize: 256,
                        attribution: '© OpenStreetMap contributors'
                    }
                },
                layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
            },
            center: [rideMapPoints[0].longitude, rideMapPoints[0].latitude],
            zoom: 12,
            attributionControl: { compact: true }
        });
        rideMap.on('load', () => {
            rideMap.addSource('route', { type: 'geojson', data: geojson });
            rideMap.addLayer({
                id: 'route-line',
                type: 'line',
                source: 'route',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-width': 4, 'line-color': colorExpr }
            });
            rideMap.addSource('cursor', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            rideMap.addLayer({
                id: 'cursor-dot',
                type: 'circle',
                source: 'cursor',
                paint: {
                    'circle-radius': 7,
                    'circle-color': '#5AF822',
                    'circle-stroke-color': '#1E252D',
                    'circle-stroke-width': 2
                }
            });
            rideMap.addSource('start', { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [rideMapPoints[0].longitude, rideMapPoints[0].latitude] } }] } });
            rideMap.addLayer({ id: 'start-dot', type: 'circle', source: 'start', paint: { 'circle-radius': 5, 'circle-color': '#2F7D0E', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
            /* Reverse sync: hovering the route moves the cursor on the graphs. */
            rideMap.on('mousemove', (e) => {
                const hits = rideMap.queryRenderedFeatures(e.point, { layers: ['route-line'] });
                if (!hits.length) { setRideCursor(null, 0); return; }
                if (cursorRaf) return;
                const mapIdx = hits[0].properties.i;
                cursorRaf = requestAnimationFrame(() => {
                    cursorRaf = null;
                    cursorFromMapPoint(mapIdx);
                });
            });
            rideMap.on('mouseout', () => setRideCursor(null, 0));
            fitRouteBounds();
        });
    } else {
        rideMap.getSource('route').setData(geojson);
        rideMap.setPaintProperty('route-line', 'line-color', colorExpr);
        rideMap.getSource('start').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [rideMapPoints[0].longitude, rideMapPoints[0].latitude] } }] });
        fitRouteBounds();
    }
}

function fitRouteBounds() {
    if (!rideMap || !rideMapPoints.length) return;
    const bounds = new maplibregl.LngLatBounds();
    rideMapPoints.forEach((p) => bounds.extend([p.longitude, p.latitude]));
    rideMap.fitBounds(bounds, { padding: 30, duration: 0 });
}

/* Marker follows the hovered time position on the graphs. */
function updateMapCursor(idx, total) {
    if (!rideMap || !rideMapPoints.length || typeof maplibregl === 'undefined') return;
    const src = rideMap.getSource('cursor');
    if (!src) return;
    if (idx == null || !total) {
        src.setData({ type: 'FeatureCollection', features: [] });
        return;
    }
    const p = rideMapPoints[Math.min(rideMapPoints.length - 1, Math.round((idx / Math.max(1, total - 1)) * (rideMapPoints.length - 1)))];
    src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] } }] });
}

/* ---- Ride Insights (Phase 2A): ARE-style graph groups ----------------- */
/* The 8 graph groups replicate the Avinox Ride Explorer layout 1:1
   (series, dual axes, colours) using the channels extracted by our
   parser. Stacked, cursor-synchronized, drag-to-zoom (double-click
   resets), drag titles to reorder, click legend values to toggle. */

let loadedRides = [];          // [{ metadata, samples, label }]
let rideCharts = [];           // active Chart instances (stacked)
let modalChart = null;
let selectedRideIndex = 0;
let graphOrder = null;         // persisted group order

/* Fast cursor: a dashed vertical line drawn on a dedicated overlay
   canvas per graph (no chart re-render) + the map marker. Hovering the
   map drives the same cursor on the graphs. */
let cursorRaf = null;

function ensureCursorOverlay(chart) {
    const areaEl = chart.canvas.parentElement; // .chart-area
    if (!areaEl) return null;
    let ov = areaEl.querySelector(".cursor-overlay");
    if (!ov) {
        ov = document.createElement("canvas");
        ov.className = "cursor-overlay";
        areaEl.appendChild(ov);
    }
    const area = chart.chartArea;
    if (!area) return ov;
    ov.style.left = area.left + "px";
    ov.style.top = area.top + "px";
    ov.style.width = (area.right - area.left) + "px";
    ov.style.height = (area.bottom - area.top) + "px";
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round((area.right - area.left) * dpr));
    const h = Math.max(1, Math.round((area.bottom - area.top) * dpr));
    if (ov.width !== w || ov.height !== h) { ov.width = w; ov.height = h; }
    return ov;
}

function drawCursorOverlay(chart, idx) {
    const ov = ensureCursorOverlay(chart);
    if (!ov) return;
    const ctx = ov.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ov.width, ov.height);
    if (idx == null) return;
    const area = chart.chartArea;
    if (!area) return;
    const labels = chart.data.labels.length;
    if (labels < 2) return;
    const x = ((idx / (labels - 1)) * (area.right - area.left)) * dpr;
    ctx.beginPath();
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.lineWidth = dpr;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ov.height);
    ctx.stroke();
}

/* Central cursor: draws the line on every graph and moves the map marker. */
function setRideCursor(idx, totalLabels) {
    rideCursorIndex = idx;
    rideCharts.forEach((c) => {
        c.canvas.dataset.cursorIndex = idx == null ? "" : String(idx);
        drawCursorOverlay(c, idx);
    });
    updateMapCursor(idx, totalLabels);
}

/* Reverse direction: a point on the route maps back to the graph index. */
function cursorFromMapPoint(mapIdx) {
    const charts = rideCharts.filter((c) => c.data.labels && c.data.labels.length > 1);
    if (!charts.length || !rideMapPoints.length) return;
    const total = charts[0].data.labels.length;
    const graphIdx = Math.round((mapIdx / Math.max(1, rideMapPoints.length - 1)) * (total - 1));
    setRideCursor(graphIdx, total);
}

function wireCursorSync(chart) {
    const canvas = chart.canvas;
    canvas.addEventListener("mousemove", (e) => {
        const area = chart.chartArea;
        if (!area) return;
        const x = e.offsetX;
        if (x < area.left || x > area.right) return;
        const idx = Math.round(((x - area.left) / (area.right - area.left)) * (chart.data.labels.length - 1));
        if (cursorRaf) return;
        cursorRaf = requestAnimationFrame(() => {
            cursorRaf = null;
            setRideCursor(idx, chart.data.labels.length);
        });
    });
    canvas.addEventListener("mouseleave", () => {
        setRideCursor(null, 0);
    });
}

function rideTheme() {
    const s = getComputedStyle(document.documentElement);
    const t = (n) => s.getPropertyValue(n).trim();
    return {
        grid: t("--surface-3"), tick: t("--muted"), faint: t("--faint"),
        surface: t("--surface"), accent: t("--accent"),
        eco: t("--mode-eco"), auto: t("--mode-auto"), trail: t("--mode-trail"),
        turbo: t("--mode-turbo"), custom: t("--mode-custom"),
        accentFill: "rgba(39, 106, 11, 0.14)"
    };
}

function downsampleRide(samples, buckets) {
    const size = Math.max(1, Math.ceil(samples.length / buckets));
    const out = [];
    for (let i = 0; i < samples.length; i += size) {
        const chunk = samples.slice(i, i + size);
        const mean = (fn) => chunk.reduce((a, s) => a + (fn(s) || 0), 0) / chunk.length;
        const max = (fn) => Math.max(...chunk.map((s) => fn(s) || 0));
        out.push({
            minute: Math.round((chunk[0].timestamp - samples[0].timestamp) / 60),
            speed: mean((s) => s.speed),
            cadence: mean((s) => s.cadence),
            battery: mean((s) => s.battery),
            assist: chunk.at(-1).assist,
            riderMean: mean((s) => s.riderPower),
            motorMean: mean((s) => s.motorPower),
            motorMax: max((s) => s.motorPower),
            totalPowerMean: mean((s) => s.totalPower),
            motorTorqueMean: mean((s) => s.motorTorque),
            riderTorqueMean: mean((s) => s.riderTorque),
            totalTorqueMean: mean((s) => s.totalTorque),
            altitude: mean((s) => s.altitude),
            gradientMean: mean((s) => s.gradient),
            gearMean: mean((s) => s.gear),
            heartMean: mean((s) => s.heartRate),
            temperature: mean((s) => s.temperature),
            pressure: mean((s) => s.pressure),
            distanceKm: chunk.at(-1).distanceKm,
            /* riderEnergyKj is a CUMULATIVE counter computed by the bike
               firmware (monotonic, ends at the total ARE displays). The
               graph shows the counter itself; the ride total is the last
               value - NOT the sum of all samples. */
            riderEnergyKj: chunk.at(-1).riderEnergyKj,
            imuX: mean((s) => s.imuX),
            imuY: mean((s) => s.imuY),
            imuZ: mean((s) => s.imuZ)
        });
    }
    return out;
}

function areaDataset(label, data, color, extra) {
    /* Translucent fill (15%): full-opacity areas hide the other series
       stacked in the same graph. */
    return Object.assign({
        label, data,
        borderColor: color,
        backgroundColor: color + "26",
        fill: true,
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.2,
        spanGaps: true
    }, extra || {});
}

function lineDataset(label, data, color, extra) {
    return Object.assign({
        label, data,
        borderColor: color,
        backgroundColor: "transparent",
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.2,
        spanGaps: true,
        fill: false
    }, extra || {});
}

/* The 8 ARE graph groups (series, axes and colours replicated 1:1)
   plus our own energy-by-level bar chart at the end. */
function rideGraphSpecs(b) {
    const g = (fn) => b.map((x) => {
        const v = fn(x);
        return v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
    });
    return [
        {
            id: "elevation", title: "Elevation & Gradient (m / %)", right: true, height: 150,
            datasets: [
                areaDataset("Altitude", g((x) => x.altitude), "#665d50"),
                lineDataset("Gradient", g((x) => x.gradientMean), "#e26435", { yAxisID: "y1" })
            ]
        },
        {
            id: "speed", title: "Speed & Cadence (km/h / rpm)", right: true, height: 150,
            datasets: [
                areaDataset("Speed", g((x) => x.speed), "#276bc1"),
                lineDataset("Cadence", g((x) => x.cadence), "#16a078", { yAxisID: "y1" })
            ]
        },
        {
            id: "power", title: "Power (W)", height: 170,
            datasets: [
                areaDataset("Rider", g((x) => x.riderMean), "#e06432"),
                areaDataset("Motor", g((x) => x.motorMean), "#7353b6"),
                lineDataset("Total", g((x) => x.totalPowerMean), "#192f27")
            ]
        },
        {
            id: "torque", title: "Torque (Nm)", height: 150,
            datasets: [
                areaDataset("Rider", g((x) => x.riderTorqueMean), "#d99a26"),
                areaDataset("Motor", g((x) => x.motorTorqueMean), "#3d83bd"),
                lineDataset("Total", g((x) => x.totalTorqueMean), "#313e38")
            ]
        },
        {
            id: "gear", title: "Gear, Heart & Assist", right: true, height: 150,
            datasets: [
                lineDataset("Gear", g((x) => x.gearMean), "#2d6655"),
                lineDataset("Assist", g((x) => x.assist), "#8f6ab8"),
                lineDataset("Heart rate", g((x) => x.heartMean), "#ce3a4e", { yAxisID: "y1" })
            ]
        },
        {
            id: "environment", title: "Battery & Environment (% / °C / kPa)", right: true, height: 150,
            datasets: [
                areaDataset("Battery", g((x) => x.battery), "#68a52f"),
                lineDataset("Temperature", g((x) => x.temperature), "#e57632"),
                lineDataset("Pressure", g((x) => x.pressure), "#697a96", { yAxisID: "y1" })
            ]
        },
        {
            id: "distance", title: "Distance & Energy (km / kJ)", right: true, height: 150,
            datasets: [
                areaDataset("Distance", g((x) => x.distanceKm), "#316c96"),
                lineDataset("Rider energy", g((x) => x.riderEnergyKj), "#dc8231", { yAxisID: "y1" })
            ]
        },
        {
            id: "imu", title: "Raw IMU channels", height: 130,
            datasets: [
                lineDataset("IMU X", g((x) => x.imuX), "#d45151"),
                lineDataset("IMU Y", g((x) => x.imuY), "#3d8a6c"),
                lineDataset("IMU Z", g((x) => x.imuZ), "#476bb1")
            ]
        },
        {
            id: "energy", title: "Energy by Assist Level (Wh)", bar: true, height: 180,
            analysis: true,
            datasets: []
        }
    ];
}

function rideChartOptions(height, group) {
    const T = rideTheme();
    const scales = {
        x: { grid: { display: false }, ticks: { color: T.tick, maxTicksLimit: 10, callback: (v) => v + "m", font: { size: 9 } } },
        y: { position: "left", grid: { color: T.grid }, ticks: { color: T.tick, font: { size: 9 } } }
    };
    if (group && group.right) {
        scales.y1 = { position: "right", grid: { display: false }, ticks: { color: T.tick, font: { size: 9 } } };
    }
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        normalized: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
            legend: { display: true, position: "top", labels: { color: T.tick, boxWidth: 12, font: { size: 10 } } },
            tooltip: { callbacks: { title: (items) => "min " + items[0].label } },
            zoom: {
                syncGroups: ["avinox-ride"],
                pan: { enabled: true, mode: "x", modifierKey: "shift" },
                zoom: { drag: { enabled: true }, mode: "x" },
                limits: { x: { min: "original", max: "original" } }
            }
        },
        scales
    };
}

function buildRideGraphs(ride, analysis) {
    const container = document.getElementById("rideGraphs");
    if (!container) return;
    container.innerHTML = "";
    rideCharts = [];

    const buckets = downsampleRide(ride.samples, 200);
    const labels = buckets.map((b) => b.minute);
    const order = getGraphOrder();
    const specs = rideGraphSpecs(buckets);
    specs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const T = rideTheme();

    for (const spec of specs) {
        const card = document.createElement("div");
        card.className = "chart-card ride-graph";
        card.draggable = true;
        card.dataset.graphId = spec.id;

        const head = document.createElement("div");
        head.className = "ride-graph-head";
        const title = document.createElement("h3");
        title.className = "chart-title";
        title.style.textAlign = "left";
        title.textContent = spec.title;
        head.appendChild(title);
        const actions = document.createElement("div");
        actions.className = "ride-graph-actions";
        /* Pin: the pinned graph sticks to the top while scrolling. */
        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "mini-btn pin-btn";
        pin.setAttribute("aria-label", "Pin " + spec.title);
        pin.title = "Pin to top";
        pin.textContent = "📌";
        pin.addEventListener("click", () => togglePin(spec.id, card));
        actions.appendChild(pin);
        if (!spec.bar) {
            const expand = document.createElement("button");
            expand.type = "button";
            expand.className = "mini-btn";
            expand.setAttribute("aria-label", "Enlarge " + spec.title);
            expand.title = "Enlarge";
            expand.textContent = "⤢";
            expand.addEventListener("click", () => openChartModal(spec.title, spec, labels, buckets));
            actions.appendChild(expand);
        }
        head.appendChild(actions);
        if (getPinned().includes(spec.id)) card.classList.add("pinned");
        card.appendChild(head);
        const areaEl = document.createElement("div");
        areaEl.className = "chart-area ride-graph-area";
        areaEl.style.height = spec.height + "px";
        const canvas = document.createElement("canvas");
        canvas.id = "graph-" + spec.id;
        areaEl.appendChild(canvas);
        card.appendChild(areaEl);
        container.appendChild(card);

        let cfg;
        if (spec.bar) {
            /* Our own energy-by-level chart (needs the analysis). */
            const levels = analysis ? analysis.levels : [];
            cfg = {
                type: "bar",
                data: {
                    labels: levels.map((l) => "L" + l.level),
                    datasets: [{ label: "Motor energy (Wh)", data: levels.map((l) => Math.round(l.motorWh)), backgroundColor: [T.eco, T.auto, T.trail, T.turbo, T.custom], borderRadius: 4 }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, animation: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: T.tick, font: { size: 10, weight: "bold" } } },
                        y: { grid: { color: T.grid }, ticks: { color: T.tick, font: { size: 9 } } }
                    }
                }
            };
        } else {
            cfg = {
                type: "line",
                data: { labels, datasets: spec.datasets },
                options: rideChartOptions(spec.height, spec),
                plugins: []
            };
        }
        const chart = new Chart(canvas.getContext("2d"), cfg);
        if (!spec.bar) {
            chart.canvas.addEventListener("dblclick", () => chart.resetZoom());
        }
        chart.update("none");
        wireCursorSync(chart);
        applyPinOffsets();
        rideCharts.push(chart);
    }

    /* Drag titles to reorder (persisted). */
    let dragId = null;
    container.querySelectorAll(".ride-graph").forEach((card) => {
        card.addEventListener("dragstart", () => { dragId = card.dataset.graphId; });
        card.addEventListener("dragover", (e) => e.preventDefault());
        card.addEventListener("drop", (e) => {
            e.preventDefault();
            const targetId = card.dataset.graphId;
            if (!dragId || dragId === targetId) return;
            const order = getGraphOrder();
            const from = order.indexOf(dragId), to = order.indexOf(targetId);
            order.splice(to, 0, order.splice(from, 1)[0]);
            setGraphOrder(order);
            rebuildRideGraphs();
        });
    });
}

/* Pinned graphs: stick to the top of the viewport while scrolling.
   Multiple pins stack: each gets an offset based on how many pinned
   graphs precede it in the DOM. */
function getPinned() {
    try {
        const saved = JSON.parse(localStorage.getItem("avinox-pinned-graphs") || "[]");
        return Array.isArray(saved) ? saved : [];
    } catch (e) { return []; }
}

function applyPinOffsets() {
    const headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 62;
    let stack = headerH;
    document.querySelectorAll("#rideGraphs .ride-graph.pinned").forEach((card) => {
        /* Fixed layer: keep a placeholder so the flow does not collapse. */
        if (!card.dataset.placeholderH) card.dataset.placeholderH = String(card.offsetHeight);
        card.style.top = stack + "px";
        stack += card.offsetHeight + 8;
    });
}

/* Near the page bottom the sticky pins would be pushed up by the footer
   and overlap each other. The stack is clamped: when the remaining page
   below the viewport is shorter than the stack, the whole stack shifts
   up so the last pin never crosses the container bottom. */
function updatePinStack() {
    const pinned = Array.from(document.querySelectorAll("#rideGraphs .ride-graph.pinned"));
    if (!pinned.length) return;
    const headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 62;
    const container = document.getElementById("rideGraphs");
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    /* Space available in the viewport for the stack: from the header to
       the container's bottom edge (the pins must stay inside their
       container while it is on screen). */
    const avail = Math.max(0, Math.min(window.innerHeight, cRect.bottom) - headerH);
    const totalNeeded = pinned.reduce((a, c) => a + c.offsetHeight + 8, -8);
    let stack = headerH;
    if (totalNeeded > avail) {
        /* Compress: shift the stack up so the last pin ends at the
           container bottom. */
        stack = headerH - (totalNeeded - avail);
    }
    pinned.forEach((card) => {
        card.style.top = Math.max(0, stack) + "px";
        stack += card.offsetHeight + 8;
    });
}

function togglePin(graphId, card) {
    const pinned = getPinned();
    const i = pinned.indexOf(graphId);
    if (i >= 0) {
        pinned.splice(i, 1);
    } else {
        /* Max 2 pins: more would stack past the viewport height and
           overlap each other. */
        if (pinned.length >= 2) {
            const card2 = document.querySelector('#rideGraphs .ride-graph.pinned');
            if (card2) {
                card2.classList.remove('pinned');
                card2.style.top = '';
            }
            pinned.shift();
        }
        pinned.push(graphId);
    }
    try { localStorage.setItem("avinox-pinned-graphs", JSON.stringify(pinned)); } catch (e) { /* ignore */ }
    card.classList.toggle("pinned", pinned.includes(graphId));
    applyPinOffsets();
}

function getGraphOrder() {
    if (graphOrder) return graphOrder;
    try {
        const saved = JSON.parse(localStorage.getItem("avinox-graph-order") || "null");
        if (Array.isArray(saved)) { graphOrder = saved; return graphOrder; }
    } catch (e) { /* ignore */ }
    graphOrder = ["elevation", "speed", "power", "torque", "gear", "environment", "distance", "imu", "energy"];
    return graphOrder;
}

function setGraphOrder(order) {
    graphOrder = order;
    try { localStorage.setItem("avinox-graph-order", JSON.stringify(order)); } catch (e) { /* ignore */ }
}

function rebuildRideGraphs() {
    if (!loadedRides.length) return;
    buildRideGraphs(loadedRides[Math.min(selectedRideIndex, loadedRides.length - 1)], lastRideAnalysis);
}

function renderRideInsights() {
    const wrap = document.getElementById("rideInsights");
    if (!wrap) return;
    const ridesCal = document.getElementById("ridesCalibration");
    const selector = document.getElementById("rideSelector");
    const pickerRow = document.getElementById("ridePickerRow");
    if (!ridesCal || !selector) return;

    const hasRides = loadedRides.length > 0;
    const hasCal = !!getCalibration();
    wrap.classList.toggle("hidden", !hasRides);
    ridesCal.classList.toggle("hidden", !(hasRides || hasCal));
    const standalone = !hasRides && hasCal;
    ridesCal.classList.toggle("standalone", standalone);
    const titleText = document.getElementById("calibrationTitleText");
    if (titleText) titleText.innerText = standalone ? "Saved calibration" : "Calibration";
    const standaloneNote = document.getElementById("calibrationStandaloneNote");
    if (standaloneNote) standaloneNote.classList.toggle("hidden", !standalone);
    if (pickerRow) pickerRow.classList.toggle("hidden", !hasRides);


    selector.innerHTML = "";
    loadedRides.forEach((r, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        const km = r.samples.length ? (r.samples.at(-1).distanceKm || 0).toFixed(1) : "?";
        const d = r.metadata.start ? new Date(r.metadata.start * 1000).toLocaleDateString() : "";
        opt.textContent = (d ? d + " - " : "") + km + " km - " + r.metadata.samples + " samples";
        selector.appendChild(opt);
    });
    if (selectedRideIndex >= loadedRides.length) selectedRideIndex = loadedRides.length - 1;
    if (selectedRideIndex < 0) selectedRideIndex = 0;
    selector.value = String(selectedRideIndex);

    if (hasRides) buildRideGraphs(loadedRides[selectedRideIndex], lastRideAnalysis);
    if (hasRides) buildRideMap(loadedRides[selectedRideIndex]);
}

function openChartModal(title, spec, labels, buckets) {
    const dlg = document.getElementById("chartModal");
    const canvas = document.getElementById("chartModalCanvas");
    const titleEl = document.getElementById("chartModalTitle");
    if (!dlg || !canvas) return;
    titleEl.textContent = title;
    if (modalChart) modalChart.destroy();
    const T = rideTheme();
    const datasets = spec.datasets.map((d) => Object.assign({}, d));
    modalChart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { position: "top", labels: { color: T.tick, boxWidth: 14 } },
                tooltip: { callbacks: { title: (items) => "min " + items[0].label } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: T.tick, maxTicksLimit: 12, callback: (v) => v + "m" } },
                y: { grid: { color: T.grid }, ticks: { color: T.tick } }
            }
        }
    });
    if (typeof dlg.showModal === "function") dlg.showModal();
}

function initCalibration() {
    /* Ride selector: switching re-renders the graphs and re-runs the route
       analysis for that ride. */
    const selector = document.getElementById('rideSelector');
    if (selector) {
        selector.addEventListener('change', () => {
            selectedRideIndex = parseInt(selector.value, 10) || 0;
            if (loadedRides[selectedRideIndex]) {
                buildRideGraphs(loadedRides[selectedRideIndex], lastRideAnalysis);
                buildRideMap(loadedRides[selectedRideIndex]);
                analyzeSelectedRide(selectedRideIndex);
            }
        });
    }

    /* Colour-by selector on the map: also focuses the matching graph. */
    const CHANNEL_GRAPH = {
        speed: "speed", altitude: "elevation", gradient: "elevation",
        riderPower: "power", motorPower: "power", cadence: "speed",
        gear: "gear", battery: "environment", heartRate: "gear"
    };
    const mapChannel = document.getElementById('mapChannel');
    if (mapChannel) {
        mapChannel.addEventListener('change', () => {
            if (loadedRides[selectedRideIndex]) buildRideMap(loadedRides[selectedRideIndex]);
            const graphId = CHANNEL_GRAPH[mapChannel.value];
            const card = graphId && document.querySelector('#rideGraphs .ride-graph[data-graph-id="' + graphId + '"]');
            if (!card) return;
            card.classList.add('graph-focus');
            /* Scroll so the graph lands just below the sticky map, not
               underneath it. */
            const mapCard = document.querySelector('.ride-map-card');
            const headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 62;
            const offset = headerH + (mapCard ? mapCard.offsetHeight : 0) + 16;
            const y = card.getBoundingClientRect().top + window.scrollY - offset;
            window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
            setTimeout(() => card.classList.remove('graph-focus'), 3000);
        });
    }

    /* Copy the adb command from the file guide. */
    const copyAdb = document.getElementById('copyAdb');
    if (copyAdb) {
        copyAdb.addEventListener('click', () => {
            copyText('adb pull "/sdcard/Android/data/com.avinox.ride/files/ebike/data/" /sdcard/Download/', copyAdb);
        });
    }

    renderCalibrationState();
}

/* Parse a batch of .proto recordings into the ride library: one ride per
   file, duplicates skipped (the ride id in the header is stable across
   re-imports and renames), the calibration factor recomputed over all
   rides merged - more rides, better factor. */
async function handleProtoFiles(files) {
    if (!files.length) return;
    try {
        setFileStatus('Reading ' + files.length + ' ride file(s)…', 'info');

        /* Each file becomes a separate ride in the library: charts show
           one ride at a time (selected in the dropdown). The calibration
           factor still uses ALL rides merged. Duplicates are skipped. */
        const added = [];
        const skipped = [];
        for (const file of files) {
            const buf = await file.arrayBuffer();
            const parsed = AvinoxProtoParser.parse(buf, file.name);
            const key = parsed.metadata.rideId || parsed.metadata.fileName || file.name;
            const duplicate = loadedRides.some((r) =>
                (r.metadata.rideId || r.metadata.fileName || r.label) === key);
            if (duplicate) { skipped.push(file.name); continue; }
            const km = parsed.samples.length ? (parsed.samples.at(-1).distanceKm || 0).toFixed(1) : '?';
            const d = parsed.metadata.start ? new Date(parsed.metadata.start * 1000).toLocaleDateString() : '';
            loadedRides.push({
                metadata: parsed.metadata,
                samples: parsed.samples,
                label: (d ? d + ' - ' : '') + km + ' km'
            });
            added.push(file.name);
        }

        if (!added.length) {
            setFileStatus(skipped.length === 1
                ? 'That ride is already loaded.'
                : 'These rides are already loaded.', 'info');
            return;
        }

        const allSamples = loadedRides.flatMap((r) => r.samples);
        const earliest = loadedRides.reduce((m, r) => Math.min(m, r.metadata.start), Infinity);
        const merged = {
            metadata: {
                fileName: loadedRides.length + ' ride file(s)',
                start: earliest,
                duration: loadedRides.reduce((m, r) => m + r.metadata.duration, 0),
                samples: allSamples.length
            },
            samples: allSamples
        };

            const analysis = analyzeRideForCalibration(merged);
            lastRideAnalysis = analysis;
            /* Totals behind the factor: kept with it so a route analysis can
               still be personalised after the ride library is cleared. */
            const calKm = loadedRides.reduce((a, r) => a + (((r.samples.at(-1) || {}).distanceKm) || 0), 0);
            const calHm = loadedRides.reduce((a, r) => a + (r.metadata.ascent || 0), 0);
            const cal = {
                factor: analysis.summary.factor,
                actualWh: analysis.summary.actualWh,
                modelWh: analysis.summary.modelWh,
                whPerKm: analysis.summary.whPerKm,
                avgLevel: analysis.summary.avgLevel,
                realKm: Math.round(calKm * 10) / 10,
                realHm: Math.round(calHm),
                rideLabel: loadedRides.length + ' ride(s) · ' + analysis.summary.distanceKm + ' km'
            };
            setCalibration(cal);
            /* A route file and recordings are two different things: loading
               rides drops the loaded GPX/KML and its track. */
            clearRouteFile();
            setFileStatus('Loaded ' + loadedRides.length + ' ride(s), ' + allSamples.length + ' samples.'
                + (skipped.length ? ' (' + skipped.length + ' already loaded, skipped)' : ''), 'ok');
            renderCalibrationReport(analysis);
            selectedRideIndex = loadedRides.length - 1;
            renderRideInsights();
            /* The ride becomes the analyzed route: distance, elevation and
               grade breakdown come from this recording. */
            analyzeSelectedRide(selectedRideIndex);
            /* Recalculate the Tuner and explain what changed: the estimates
               now come from the real ride consumption. */
            const before = lastCalcRes;
            await updateSetup();
            showRideSummary(before, lastCalcRes, analysis);
        } catch (err) {
            setFileStatus(err.message, 'error');
        }
}

let lastRideAnalysis = null;

function analyzeRideForCalibration(parsed) {
    /* Only levels 1-15 are comparable with the model: special values
       (e.g. 20 = boost/walk) have no table ratio and would skew the
       factor. They are excluded from both sides of the comparison. */
    const samples = parsed.samples.filter((s) => s && s.timestamp && s.assist >= 1 && s.assist <= 15);
    if (samples.length < 10) throw Error('Not enough comparable samples in this ride file (levels 1-15).');

    /* Per-level aggregation with sample-interval weighting. */
    const byLevel = {};
    let actualWh = 0, modelWh = 0, distanceKm = 0, batteryStart = null, batteryEnd = null;
    const bikeMaxPower = 1300; // physical ceiling used by the model comparison
    /* Distance must ADD UP over merged rides: each file restarts its
       distance counter at zero, so the max would only give the longest
       ride while energy is summed over all of them. */
    let prevDist = null, distOffset = 0;

    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const prev = i > 0 ? samples[i - 1] : null;
        const dt = prev && s.timestamp > prev.timestamp ? Math.min((s.timestamp - prev.timestamp), 10) : 1;
        if (s.battery != null) {
            if (batteryStart === null) batteryStart = s.battery;
            batteryEnd = s.battery;
        }
        const rideDist = s.distanceKm || 0;
        if (prevDist !== null && rideDist < prevDist - 0.5) distOffset += prevDist; // new ride, counter restarted
        if (prevDist === null) distOffset = 0;
        prevDist = rideDist;
        distanceKm = distOffset + rideDist;

        const lvl = s.assist;
        if (!byLevel[lvl]) byLevel[lvl] = { level: lvl, seconds: 0, riderWh: 0, motorWh: 0, samples: 0, activeSeconds: 0, activeRiderWh: 0, activeMotorWh: 0 };
        const b = byLevel[lvl];
        b.seconds += dt;
        b.samples++;

        const riderW = s.riderPower || 0, motorW = s.motorPower || 0;
        b.riderWh += riderW * dt / 3600;
        b.motorWh += motorW * dt / 3600;
        actualWh += motorW * dt / 3600;

        /* Active averages: only samples where the rider is actually
           pedaling - otherwise coasting/stops dilute the averages. */
        if (riderW > 20) {
            b.activeSeconds += dt;
            b.activeRiderWh += riderW * dt / 3600;
            b.activeMotorWh += motorW * dt / 3600;
        }

        /* What the community table would deliver for the same rider input. */
        const modelMotor = Math.min(ratioOfLevelClient(lvl) * riderW, bikeMaxPower);
        modelWh += modelMotor * dt / 3600;
    }

    const levels = Object.values(byLevel)
        .filter((b) => b.seconds > 5)
        .sort((a, b) => a.level - b.level);
    if (!levels.length) throw Error('No meaningful assist samples in this ride.');

    /* Real rider profile: averages over active (pedaling) samples only. */
    const active = samples.filter((s) => (s.riderPower || 0) > 20);
    const avgRiderPower = active.length ? Math.round(active.reduce((a, s) => a + (s.riderPower || 0), 0) / active.length) : null;
    const avgCadence = active.length ? Math.round(active.reduce((a, s) => a + (s.cadence || 0), 0) / active.length) : null;

    const factor = actualWh > 1 ? actualWh / modelWh : 1;
    const fmtDuration = (sec) => {
        const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
        return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
    };

    /* Real consumption model: motor Wh per km and the assist level that
       produced it (energy-weighted). Sent to the API so range/runtime are
       estimated from real data instead of "cap x hours". */
    const whPerKm = distanceKm > 0.5 ? actualWh / distanceKm : null;
    const totalLevelWh = levels.reduce((a, l) => a + l.motorWh, 0);
    const avgLevel = totalLevelWh > 0
        ? levels.reduce((a, l) => a + l.level * l.motorWh, 0) / totalLevelWh
        : null;

    return {
        summary: {
            fileName: parsed.metadata.fileName,
            date: parsed.metadata.start ? new Date(parsed.metadata.start * 1000).toLocaleString() : '-',
            durationH: fmtDuration(parsed.metadata.duration),
            distanceKm: distanceKm.toFixed(1),
            batteryStart, batteryEnd,
            actualWh: Math.round(actualWh),
            modelWh: Math.round(modelWh),
            factor: Math.round(factor * 100) / 100,
            avgRiderPower,
            avgCadence,
            whPerKm: whPerKm ? Math.round(whPerKm * 10) / 10 : null,
            avgLevel: avgLevel ? Math.round(avgLevel * 10) / 10 : null
        },
        levels
    };
}

/* Client-side copy of the community level table (kept in sync with the
   server's ASSIST_LEVELS) so the comparison works without a round-trip. */
function ratioOfLevelClient(level) {
    const table = { 1: 0.35, 2: 0.70, 3: 1.00, 4: 1.50, 5: 1.85, 6: 2.15, 7: 2.45, 8: 3.00, 9: 3.60, 10: 4.35, 11: 5.15, 12: 6.05, 13: 7.00, 14: 7.65, 15: 8.00 };
    return table[level] || 0;
}

function renderCalibrationReport(analysis) {
    const report = document.getElementById('calibrationReport');
    if (!report) return;
    lastRideAnalysis = analysis;
    const s = analysis.summary;
    const rows = analysis.levels.map((b) => {
        const riding = b.activeSeconds > 0 ? b.activeSeconds / 3600 : 0;
        return '<tr><td>Level ' + b.level + '</td><td>' + Math.round(b.seconds / 60) + ' min</td>' +
            '<td>' + Math.round(riding > 0 ? b.activeRiderWh / riding : 0) + ' W</td>' +
            '<td>' + Math.round(riding > 0 ? b.activeMotorWh / riding : 0) + ' W</td>' +
            '<td>' + Math.round(b.seconds > 0 ? b.riderWh / (b.seconds / 3600) : 0) + ' W</td>' +
            '<td>' + b.motorWh.toFixed(0) + ' Wh</td></tr>';
    }).join('');
    report.classList.remove('hidden');
    report.innerHTML =
        '<div class="card"><div class="card-body kv-compact">' +
        kvRow('Ride date:', s.date) +
        kvRow('Duration / distance:', s.durationH + ' / ' + s.distanceKm + ' km') +
        kvRow('Battery start / finish:', (s.batteryStart ?? '—') + ' / ' + (s.batteryEnd ?? '—') + ' %') +
        kvRow('Your real averages:', (s.avgCadence ?? '—') + ' RPM · ' + (s.avgRiderPower ?? '—') + ' W (while pedaling)') +
        kvRow('Real motor energy:', s.actualWh + ' Wh') +
        kvRow('Model prediction:', s.modelWh + ' Wh') +
        '</div></div>' +
        '<div class="kb-table-wrap"><table class="kb-table"><thead><tr>' +
        '<th>Level</th><th>Time</th><th>Rider W (riding)</th><th>Motor W (riding)</th><th>Rider W (total)</th><th>Energy</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<button type="button" id="useRideAverages" class="btn btn-primary btn-block"' +
        ((s.avgCadence && s.avgRiderPower) ? '' : ' disabled') + '>Use ride averages' +
        ((s.avgCadence && s.avgRiderPower) ? ' — ' + s.avgCadence + ' RPM · ' + s.avgRiderPower + ' W' : '') +
        '</button>' +
        '<p class="hint">Estimates now come from the real consumption measured on your rides (' + (s.whPerKm ?? '?') + ' Wh/km).</p>';
    const useBtn = document.getElementById('useRideAverages');
    if (useBtn && s.avgCadence && s.avgRiderPower) {
        useBtn.addEventListener('click', () => {
            document.getElementById('cadence').value = s.avgCadence;
            document.getElementById('riderPower').value = s.avgRiderPower;
            saveForm();
            updateSetup();
        });
    }
}

/* ---- Form persistence (Phase 1) ---------------------------------------- */

const FORM_FIELDS = ['bike', 'batteryWh', 'boostDuration', 'riderWeight', 'bikeWeight', 'cadence', 'riderPower', 'ecoWkg', 'autoWkg', 'trailWkg', 'turboWkg'];

function restoreForm() {
    try {
        const saved = JSON.parse(localStorage.getItem(FORM_KEY) || '{}');
        FORM_FIELDS.forEach((id) => {
            const el = document.getElementById(id);
            if (el && saved[id] != null && saved[id] !== '') el.value = saved[id];
        });
    } catch (e) { /* ignore */ }
}

function saveForm() {
    try {
        const data = {};
        FORM_FIELDS.forEach((id) => {
            const el = document.getElementById(id);
            if (el) data[id] = el.value;
        });
        localStorage.setItem(FORM_KEY, JSON.stringify(data));
    } catch (e) { /* ignore */ }
}

/* ---- Template helpers (G4): shared markup for the result cards --------- */

function kvRow(label, value, hint) {
    return `<div class="kv-row"><span class="kv-label">${label}</span>` +
        `<span class="kv-value">${value}${hint || ''}</span></div>`;
}

function modeCard({ mode, title, badges, rows, footer }) {
    return `<div class="mode-card" data-mode="${mode}">
        <div>
            <div class="mode-head">
                <span class="mode-title">${title}</span>
                <div class="mode-badges">${(badges || []).join('')}</div>
            </div>
            <div class="kv">${(rows || []).join('')}</div>
        </div>
        ${footer ? `<p class="card-footer">${footer}</p>` : ''}
    </div>`;
}

function callout(kind, html) {
    return `<div class="callout callout-${kind}">${html}</div>`;
}

function toggleAdvancedSliders() {
    const panel = document.getElementById('advancedSlidersPanel');
    const txt = document.getElementById('advancedToggleText');
    const icon = document.getElementById('advancedToggleIcon');
    
            if(panel.classList.contains('hidden')) {
                panel.classList.remove('hidden');
                txt.innerText = "Hide Advanced Sliders";
                icon.innerText = "▾";
            } else {
                panel.classList.add('hidden');
                txt.innerText = "Show Advanced W/kg Sliders";
                icon.innerText = "▸";
            }
        }

        /* Theme colours for Chart.js, read live from the CSS custom
           properties so the charts always match the stylesheet tokens. */
        function chartTheme() {
            const s = getComputedStyle(document.documentElement);
            const t = (name) => s.getPropertyValue(name).trim();
            return {
                grid: t('--surface-3'),
                tick: t('--muted'),
                faint: t('--faint'),
                surface: t('--surface'),
                accent: t('--accent'),
                modeColors: [t('--mode-eco'), t('--mode-auto'), t('--mode-trail'), t('--mode-turbo')],
                accentFill: 'rgba(39, 106, 11, 0.14)'
            };
        }

        /* Battery duration comparison: proposed modes vs DJI stock defaults. */
function initStockChart(stock, ourRuntimes) {
    if (!stock.length) return;
    const ctx = document.getElementById('stockChart').getContext('2d');
    if (stockChartInstance) stockChartInstance.destroy();
    const theme = chartTheme();

    const byKey = {};
    stock.forEach((s) => { byKey[s.key] = s; });
    const order = ['eco', 'auto', 'trail', 'turbo'];
    const labels = order.map((k) => (byKey[k] ? byKey[k].label : k.toUpperCase()));
    const ours = order.map((k, i) => ourRuntimes[i] || 0);
    const theirs = order.map((k) => (byKey[k] ? byKey[k].runtime : 0));

    stockChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'This calculator', data: ours, backgroundColor: theme.modeColors, borderRadius: 4 },
                { label: 'DJI stock', data: theirs, backgroundColor: theme.faint, borderRadius: 4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'top', labels: { color: theme.tick, boxWidth: 12 } }
            },
            scales: {
                y: { grid: { color: theme.grid }, ticks: { color: theme.tick, font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { color: theme.tick, font: { size: 10, weight: 'bold' } } }
            }
        }
    });
}

function initCharts(rangeData, runtimeData) {
            const ctxRange = document.getElementById('rangeChart').getContext('2d');
            const ctxRuntime = document.getElementById('runtimeChart').getContext('2d');
            const theme = chartTheme();

            const chartOptions = {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { grid: { color: theme.grid }, ticks: { color: theme.tick, font: { size: 11 } } },
                    x: { ticks: { color: theme.tick, font: { size: 11, weight: 'bold' } } }
                }
            };

    if (rangeChartInstance) rangeChartInstance.destroy();
    if (runtimeChartInstance) runtimeChartInstance.destroy();

    rangeChartInstance = new Chart(ctxRange, {
        type: 'bar',
        data: {
            labels: ['ECO', 'AUTO', 'TRAIL', 'TURBO'],
            datasets: [{
                data: rangeData,
                        backgroundColor: theme.modeColors,
                        borderRadius: 4
            }]
        },
        options: chartOptions
    });

    runtimeChartInstance = new Chart(ctxRuntime, {
        type: 'bar',
        data: {
            labels: ['ECO', 'AUTO', 'TRAIL', 'TURBO'],
            datasets: [{
                data: runtimeData,
                        backgroundColor: theme.modeColors,
                        borderRadius: 4
            }]
        },
        options: chartOptions
    });
}

function bindSliderAndText(textId, sliderId) {
    const txt = document.getElementById(textId);
    const sld = document.getElementById(sliderId);
    txt.addEventListener('input', () => {
        let val = parseFloat(txt.value);
        if (!isNaN(val)) {
            if (val < parseFloat(sld.min)) val = parseFloat(sld.min);
            if (val > parseFloat(sld.max)) val = parseFloat(sld.max);
            sld.value = val;
            updateSetup();
        }
    });
    sld.addEventListener('input', () => {
        txt.value = sld.value;
        updateSetup();
    });
}

bindSliderAndText('ecoWkg', 'ecoWkgSlider');
bindSliderAndText('autoWkg', 'autoWkgSlider');
bindSliderAndText('trailWkg', 'trailWkgSlider');
bindSliderAndText('turboWkg', 'turboWkgSlider');

// Preset mapping loaders
function loadPreset(eco, auto, trail, turbo) {
    document.getElementById('ecoWkg').value = eco;
    document.getElementById('ecoWkgSlider').value = eco;
    document.getElementById('autoWkg').value = auto;
    document.getElementById('autoWkgSlider').value = auto;
    document.getElementById('trailWkg').value = trail;
    document.getElementById('trailWkgSlider').value = trail;
    document.getElementById('turboWkg').value = turbo;
    document.getElementById('turboWkgSlider').value = turbo;
    updateSetup();
}

async function updateSetup() {
    const selectedBattery = document.getElementById('batteryWh').value;
    document.getElementById('rangeChartTitle').innerText = 'Estimated Max Range (km) • Battery ' + selectedBattery + 'Wh';

    const data = {
        bike: document.getElementById('bike').value,
        batteryWh: selectedBattery,
        boostDuration: document.getElementById('boostDuration').value,
        riderWeight: document.getElementById('riderWeight').value,
        bikeWeight: document.getElementById('bikeWeight').value,
        cadence: document.getElementById('cadence').value,
        riderPower: document.getElementById('riderPower').value,
        ecoWkg: document.getElementById('ecoWkg').value,
        autoWkg: document.getElementById('autoWkg').value,
        trailWkg: document.getElementById('trailWkg').value,
        turboWkg: document.getElementById('turboWkg').value
    };

    /* Real-ride consumption: when rides are calibrated, ask the API to
       derive range/runtime from the measured Wh/km instead of the cap. */
    const calibration = getCalibration();
    if (calibration && calibration.whPerKm > 0 && calibration.avgLevel > 0) {
        data.realWhPerKm = calibration.whPerKm;
        data.realLevel = calibration.avgLevel;
    }

    try {
        const response = await axios.post('/api/calculate', data);
        const res = response.data;
        saveForm();
        const cal = getCalibration();
        document.getElementById('sysWeight').innerText = 'Total Weight: ' + res.totalWeight + ' kg';
        
        const modes = [
            { name: 'ECO', key: 'eco', val: parseFloat(data.ecoWkg), data: res.eco, desc: 'Maximum range baseline profile.' },
            { name: 'AUTO', key: 'auto', val: parseFloat(data.autoWkg), data: res.auto, desc: 'Dynamic torque adjustments matching slopes.' },
            { name: 'TRAIL', key: 'trail', val: parseFloat(data.trailWkg), data: res.trail, desc: 'Optimized technical climbing engagement map.' },
            { name: 'TURBO', key: 'turbo', val: parseFloat(data.turboWkg), data: res.turbo, desc: 'Peak emergency boost map.' }
        ];

        const grid = document.getElementById('resultsGrid');
        grid.innerHTML = '';
        modes.forEach(m => {
            const isHighDrain = m.val >= 6.0;
            const wkgBadge = isHighDrain
                ? `<span class="badge badge-danger">${m.data.wkg} W/kg</span>`
                : `<span class="badge badge-mode-${m.key}">${m.data.wkg} W/kg</span>`;
            const typeBadge = `<span class="badge badge-soft">${m.data.type === 'range' ? 'Range' : 'Fixed'}</span>`;
            const accelRow = m.data.maxAccel !== null && m.data.maxAccel !== undefined
                ? kvRow('Max Acceleration:', m.data.maxAccel)
                : '';
            const warnBlock = (m.data.warnings && m.data.warnings.length)
                ? callout('danger', m.data.warnings.join(' '))
                : '';
            const powerHint = (m.data.idealPower !== m.data.maxPower)
                ? ` <span class="kv-hint">(computed ${m.data.idealPower} W)</span>` : '';
            const drawHint = (m.data.typicalPower < m.data.maxPower)
                ? ` <span class="kv-hint">(expected draw ~${m.data.typicalPower} W at your input)</span>` : '';
            const calHint = res.basedOnRealRides
                ? ` <span class="kv-hint">· from your rides (${cal ? cal.whPerKm : '?'} Wh/km)</span>` : '';
            const torqueHint = (m.data.idealTorque !== m.data.maxTorque)
                ? ` <span class="kv-hint">(computed ${m.data.idealTorque} Nm)</span>` : '';

            grid.innerHTML += modeCard({
                mode: m.key,
                title: m.name,
                badges: [typeBadge, wkgBadge],
                rows: [
                    kvRow('Assist Bound:', `${m.data.level}${m.data.levelPct ? ` <span class="kv-hint">· ${m.data.levelPct} of rider input</span>` : ''}`),
                    kvRow('Power Limit:', m.data.watts, powerHint + drawHint + calHint),
                    kvRow('Max Torque:', m.data.torque, torqueHint),
                    kvRow('Max Overrun:', m.data.maxOverrun),
                    kvRow('Assist Start:', m.data.assistStart),
                    kvRow('Continued Assist:', m.data.continuedAssist),
                    accelRow
                ],
                footer: m.desc
            }) + warnBlock;
        });

        const warnBox = document.getElementById('calcWarnings');
        warnBox.innerHTML = (res.warnings && res.warnings.length)
            ? res.warnings.map(w => callout('warn', w)).join('')
            : '';

        initCharts(
            [res.eco.range, res.auto.range, res.trail.range, res.turbo.range],
            [res.eco.runtime, res.auto.runtime, res.trail.runtime, res.turbo.runtime]
        );
        initStockChart(
            res.stock || [],
            [res.eco.runtime, res.auto.runtime, res.trail.runtime, res.turbo.runtime]
        );
        lastCalcRes = res;
        return res;
    } catch (err) {
        console.error(err);
        return null;
    }
}

/* ==================================================================
 * Route file import (GPX / KML)
 * Parsing happens entirely in the browser: coordinates never leave
 * the device. Only distance and elevation gain are sent to the API.
 * ================================================================== */

let parsedRoute = null;       // { source, geometries, warnings }
let selectedGeometries = [];  // indices into parsedRoute.geometries
let routeStats = null;
let routeGrades = null;       // grade distribution + climbs
let elevationChartInstance = null;
/* What the analysis panel currently describes: the route file name, a ride
   label, or null for a hand-typed route. Shown next to the verdict so the
   panel is never ambiguous once a file and some rides are both loaded. */
let analysisSourceLabel = null;
let routeFileName = null;

function setFileStatus(msg, kind) {
    const el = document.getElementById('fileStatus');
    const colors = { error: 'status-error', ok: 'status-ok', info: 'status-info' };
    el.className = 'file-status ' + (colors[kind] || colors.info);
    el.innerText = msg || '';
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function geometryDistance(geom) {
    let d = 0;
    for (let i = 1; i < geom.points.length; i++) {
        d += AvinoxRoute.haversine(geom.points[i - 1], geom.points[i]);
    }
    return d;
}

async function handleRouteFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
        setFileStatus('File is larger than 10 MB.', 'error');
        return;
    }
    routeFileName = file.name;
    /* The "Rides analyzed" dialog described the previous input: the route
       file now owns the analysis, so it must not sit on screen. */
    const summaryDlg = document.getElementById('rideSummaryDialog');
    if (summaryDlg && summaryDlg.open) summaryDlg.close();
    setFileStatus('Reading ' + file.name + '…', 'info');

    let text;
    try {
        text = await file.text();
    } catch (e) {
        setFileStatus('Could not read the file.', 'error');
        return;
    }

            try {
                parsedRoute = AvinoxRoute.parseRouteFile(text, file.name);
            } catch (err) {
                parsedRoute = null;
                routeStats = null;
                document.getElementById('geometryPanel').classList.add('hidden');
                document.getElementById('geometryPicker').classList.add('hidden');
                document.getElementById('fileSummary').classList.add('hidden');
                document.getElementById('elevationPanel').classList.add('hidden');
                setFileStatus(err.message, 'error');
                return;
            }

    if (!parsedRoute.geometries.length) {
        setFileStatus(parsedRoute.warnings.join(' ') || 'No route found in this file.', 'error');
        return;
    }

    /* A planned route and recorded rides are two different things: the tab
       holds one at a time, so the route file drops the ride library (the
       calibration - a measurement stored on the device - survives it). */
    const hadRides = loadedRides.length;
    if (hadRides) clearRides();

    setFileStatus(parsedRoute.source.toUpperCase() + ' parsed — ' +
        parsedRoute.geometries.length + ' geometry(ies) found.'
        + (hadRides ? ' The loaded ride(s) were cleared.' : ''), 'ok');

    // Select everything by default. GPX track segments and KML
    // MultiGeometry parts are normally one ride split by pauses or by
    // the exporter, so the expected behaviour is "load the whole file".
    // This is safe because segments are never bridged when measuring:
    // selecting them all cannot invent distance between them.
    selectedGeometries = parsedRoute.geometries.map((g, i) => i);

    renderGeometryPicker();
    applyRouteSelection();
}

        function renderGeometryPicker() {
            const panel = document.getElementById('geometryPanel');
            const box = document.getElementById('geometryPicker');
            if (!parsedRoute || parsedRoute.geometries.length < 2) {
                panel.classList.add('hidden');
                box.classList.add('hidden');
                box.innerHTML = '';
                return;
            }
            panel.classList.remove('hidden');
            box.classList.remove('hidden');

            const total = parsedRoute.geometries.length;
            box.innerHTML = `
                <div class="picker-actions">
                    <button type="button" id="geomAll" class="mini-btn">All</button>
                    <button type="button" id="geomNone" class="mini-btn">First only</button>
                </div>` +
                parsedRoute.geometries.map((g, i) => `
                    <label class="track-item">
                        <input type="checkbox" data-geom="${i}" ${selectedGeometries.indexOf(i) >= 0 ? 'checked' : ''} class="check">
                        <span>${escapeHtml(g.name)}</span>
                        <span class="track-km">${(geometryDistance(g) / 1000).toFixed(1)} km</span>
                    </label>`).join('');

            const updateCounter = () => {
                const el = document.getElementById('geomCounter');
                if (el) el.innerText = selectedGeometries.length + ' of ' + total + ' segments selected';
            };
            updateCounter();

    const syncCheckboxes = () => {
        box.querySelectorAll('input[data-geom]').forEach((c) => {
            c.checked = selectedGeometries.indexOf(parseInt(c.getAttribute('data-geom'), 10)) >= 0;
        });
    };

    box.querySelectorAll('input[data-geom]').forEach((cb) => {
        cb.addEventListener('change', () => {
            const picked = [];
            box.querySelectorAll('input[data-geom]').forEach((c) => {
                if (c.checked) picked.push(parseInt(c.getAttribute('data-geom'), 10));
            });
            // An empty selection cannot be analysed.
            if (picked.length === 0) {
                cb.checked = true;
                picked.push(parseInt(cb.getAttribute('data-geom'), 10));
            }
            selectedGeometries = picked;
            updateCounter();
            applyRouteSelection();
        });
    });

    document.getElementById('geomAll').addEventListener('click', () => {
        selectedGeometries = parsedRoute.geometries.map((g, i) => i);
        syncCheckboxes();
        updateCounter();
        applyRouteSelection();
    });

    document.getElementById('geomNone').addEventListener('click', () => {
        // Empty selections cannot be analysed: keep only the first segment.
        selectedGeometries = [0];
        syncCheckboxes();
        updateCounter();
        applyRouteSelection();
    });
}

function applyRouteSelection() {
    if (!parsedRoute) return;
    const chosen = selectedGeometries
        .map((i) => parsedRoute.geometries[i])
        .filter(Boolean);
    if (!chosen.length) return;

    const route = AvinoxRoute.buildRoute(chosen);
    routeStats = AvinoxRoute.computeStats(route.points);
    routeGrades = AvinoxRoute.computeGradeStats(route.points);
    analysisSourceLabel = routeFileName;

    renderFileSummary();
    renderElevationChart(chosen);
    renderRouteAnalysis();

    /* The analysis follows the route: loading a file (or changing the
       segments) re-runs it, so the energy card can never describe a
       different track than the grades and the profile next to it. */
    document.getElementById('missionForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

function copyText(text, btn) {
    const done = () => {
        if (btn) {
            const original = btn.innerText;
            btn.innerText = 'Copied';
            setTimeout(() => { btn.innerText = original; }, 1200);
        }
    };
    const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
        document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
        fallback();
    }
}

function renderRouteAnalysis() {
    const block = document.getElementById('routeAnalysis');
    const bars = document.getElementById('gradeBars');
    const climbs = document.getElementById('climbList');

    if (!routeGrades || !routeGrades.ok) {
        block.classList.add('hidden');
        return;
    }
    block.classList.remove('hidden');

            const colors = {
                descent: 'var(--mode-auto)', flat: 'var(--mode-eco)', rolling: 'var(--accent-hover)',
                climb: 'var(--mode-trail)', steep: 'var(--mode-turbo)', extreme: 'var(--mode-custom)'
            };
            const d = routeGrades.distribution;

            bars.innerHTML = AvinoxRoute.gradeBands.map((b) => {
                const pct = d[b.key] || 0;
                return `
                    <div class="bar">
                        <span class="bar-label">${b.label}</span>
                        <div class="bar-track"><div style="width:${pct.toFixed(1)}%;background:${colors[b.key]}" class="bar-fill"></div></div>
                        <span class="bar-value">${pct.toFixed(0)}%</span>
                    </div>`;
            }).join('');

            const cs = routeGrades.climbSummary;
            climbs.innerHTML = cs.count
                ? `<p class="hint">${cs.count} climb(s) · median grade ${cs.medianGrade.toFixed(1)}% ·
                   longest ${cs.longestKm.toFixed(1)} km · peak ${routeGrades.maxGrade.toFixed(1)}%</p>`
                : '<p class="hint">No sustained climbs detected.</p>';
}

function renderRouteModes(res) {
    const block = document.getElementById('routeModes');
    const grid = document.getElementById('routeModesGrid');
    const notes = document.getElementById('routeModeNotes');

    if (!res.modes || !res.modes.length) {
        block.classList.add('hidden');
        return;
    }
    block.classList.remove('hidden');

            // Match the column count to the number of proposals, so three
            // modes sit on one row instead of leaving a lonely third card.
            const count = res.modes.length;
            grid.className = 'result-grid ' + (
                count >= 4 ? 'cols-4' :
                count === 3 ? 'cols-3' :
                count === 2 ? 'cols-2' :
                'cols-1'
            );

            grid.innerHTML = res.modes.map((m) => `
                <div class="mode-card" data-mode="custom">
                    <div>
                        <div class="mode-head">
                            <span class="mode-title">${m.label}</span>
                            <span class="badge badge-soft">Fixed</span>
                        </div>
                        <div class="kv">
                            ${kvRow('Assist Level:', `${m.assistLevel}${m.assistLevelPct ? ` <span class="kv-hint">· ${m.assistLevelPct} of rider input</span>` : ''}`)}
                            ${kvRow('Max Power:', m.maxPower + ' W')}
                            ${kvRow('Max Torque:', m.maxTorque + ' Nm')}
                            ${kvRow('Max Overrun:', m.maxOverrun)}
                            ${kvRow('Assist Start:', m.assistStart)}
                            ${kvRow('Continued Assist:', m.continuedAssist)}
                        </div>
                    </div>
                    <p class="card-footer">${escapeHtml(m.rationale)}</p>
                    <button type="button" data-copy-mode="${m.key}"
                        class="mini-btn copy-btn">Copy</button>
                </div>`).join('');

            notes.innerHTML = (res.notes || []).map((n) => '<p>· ' + escapeHtml(n) + '</p>').join('');

    grid.querySelectorAll('button[data-copy-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-copy-mode');
            const m = res.modes.filter((x) => x.key === key)[0];
            if (!m) return;
            copyText([
                m.label + ' — ' + res.bike.name,
                'Assist Level: ' + m.assistLevel,
                'Max Torque: ' + m.maxTorque + ' Nm',
                'Max Power: ' + m.maxPower + ' W',
                'Max Overrun: ' + m.maxOverrun,
                'Assist Start: ' + m.assistStart,
                'Continued Assist: ' + m.continuedAssist
            ].join('\n'), btn);
        });
    });
}

function renderFileSummary() {
    const box = document.getElementById('fileSummary');
    box.classList.remove('hidden');

            if (!routeStats || !routeStats.ok) {
                box.innerHTML = callout('danger',
                    escapeHtml(routeStats ? routeStats.error : 'Could not analyse the route.'));
                return;
            }

            const s = routeStats;
            const eleOk = s.elevationStatus === 'available';
            const qualityClass = { good: 'status-ok', noisy: 'status-info', unavailable: 'status-error' }[s.quality];
            const qualityLabel = { good: 'Good', noisy: 'Noisy (smoothed)', unavailable: 'Unavailable' }[s.quality];

            const rows = [
                ['Distance', s.distanceKm.toFixed(1) + ' km'],
                ['Elevation gain', eleOk ? Math.round(s.elevationGainM) + ' m' : '—'],
                ['Elevation loss', eleOk ? Math.round(s.elevationLossM) + ' m' : '—'],
                ['Min / max altitude', eleOk ? Math.round(s.minElevationM) + ' / ' + Math.round(s.maxElevationM) + ' m' : '—'],
                ['Points / segments', s.pointCount + ' / ' + s.segmentCount]
            ];

            // Parser warnings (ignored points/polygons, several geometries found)
            // must be surfaced too: they were dropped whenever a route parsed.
            const allWarnings = ((parsedRoute && parsedRoute.warnings) || []).concat(s.warnings);

            box.innerHTML = `
                <div class="card">
                    <div class="card-body kv-compact">
                        ${rows.map((r) => kvRow(r[0], r[1])).join('')}
                        ${kvRow('Elevation quality', `<span class="${qualityClass}">${qualityLabel}</span>`)}
                    </div>
                </div>
                ${allWarnings.length ? callout('warn', allWarnings.map((w) => escapeHtml(w)).join('<br>')) : ''}
            `;

    // Feed the existing mission endpoint. Never write a value the field
    // itself would reject: native validation would then block submission
    // silently, with no analysis and no visible explanation.
    document.getElementById('targetKm').value = Math.max(0.1, s.distanceKm).toFixed(1);
    if (eleOk) {
        document.getElementById('targetH_m').value = Math.round(s.elevationGainM);
    } else {
        // Do not silently reuse the previous route's elevation gain (or
        // the 1500 m default) when the imported file has no altitude.
        document.getElementById('targetH_m').value = '';
    }
}

function renderElevationChart(chosen) {
    const panel = document.getElementById('elevationPanel');
    const note = document.getElementById('elevationNote');

    if (!routeStats || !routeStats.ok || routeStats.elevationStatus !== 'available') {
        panel.classList.add('hidden');
        return;
    }

    const points = [];
    let cumulative = 0;

    chosen.forEach((geom) => {
        geom.points.forEach((p, i) => {
            if (i > 0) cumulative += AvinoxRoute.haversine(geom.points[i - 1], p);
            if (Number.isFinite(p.ele)) {
                points.push({ x: Math.round(cumulative) / 1000, y: p.ele });
            }
        });
    });

    if (points.length < 2) {
        panel.classList.add('hidden');
        return;
    }
    panel.classList.remove('hidden');

            const ctx = document.getElementById('elevationChart').getContext('2d');
            if (elevationChartInstance) elevationChartInstance.destroy();
            const theme = chartTheme();

            elevationChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [{
                        data: points,
                        borderColor: theme.accent,
                        backgroundColor: theme.accentFill,
                borderWidth: 1.5,
                pointRadius: 0,
                fill: true,
                tension: 0.15
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => items[0].parsed.x.toFixed(2) + ' km',
                        label: (item) => Math.round(item.parsed.y) + ' m'
                    }
                }
            },
            scales: {
                x: {
                    // A linear distance axis. A category axis with a tick
                    // callback mislabelled the ticks, because the callback
                    // index is the tick position, not the data index.
                    type: 'linear',
                    // bounds 'ticks' (the default) stretches the axis to
                    // the next whole tick, leaving a blank strip after the
                    // route ends. 'data' stops it exactly at the last point.
                    bounds: 'data',
                    grid: { color: theme.grid },
                    ticks: {
                        color: theme.tick, font: { size: 10 }, maxTicksLimit: 8,
                        callback: (value) => (Math.round(value * 10) / 10) + ' km'
                    }
                },
                y: {
                    grid: { color: theme.grid },
                    ticks: { color: theme.tick, font: { size: 10 } }
                }
            }
        }
    });

    note.innerText = 'Elevation smoothed over ' + routeStats.smoothingWindow +
        ' point(s), gain threshold ' + AvinoxRoute.constants.ELEVATION_THRESHOLD_M + ' m.';
}

/* One drop zone for both kinds of input: a planned route (.gpx/.kml) and
   recorded rides (.proto). The extension decides the pipeline; dropped
   files of both kinds in the same batch are all handled. */
(function initRouteInput() {
    const drop = document.getElementById('routeDropZone');
    const input = document.getElementById('routeFileInput');
    if (!drop || !input) return;

    const isProto = (f) => /\.proto$/i.test(f.name);

    const handleFiles = async (list) => {
        const files = Array.from(list || []);
        if (!files.length) return;
        const protos = files.filter(isProto);
        const route = files.find((f) => !isProto(f));
        if (!protos.length && !route) {
            setFileStatus('Unsupported file: use .gpx, .kml or .proto.', 'error');
            return;
        }
        /* A route file and recordings are two different things: the tab
           holds one at a time, so a mixed drop keeps only the route file
           (recordings are reloaded on their own to switch back). */
        if (protos.length && route) {
            await handleRouteFile(route);
            setFileStatus('Loaded ' + route.name + '. A route file and recordings cannot be loaded together: reload the .proto file(s) on their own to analyze a ride instead.', 'info');
            return;
        }
        if (route) await handleRouteFile(route);
        else await handleProtoFiles(protos);
    };

    drop.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        handleFiles(input.files);
        input.value = '';
    });

    ['dragenter', 'dragover'].forEach((ev) => {
        drop.addEventListener(ev, (e) => {
            e.preventDefault();
            drop.classList.add('border-green-500');
        });
    });
    ['dragleave', 'drop'].forEach((ev) => {
        drop.addEventListener(ev, (e) => {
            e.preventDefault();
            drop.classList.remove('border-green-500');
        });
    });
    drop.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });
})();

document.getElementById('missionForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const selectedBattery = document.getElementById('batteryWh').value;
    const data = {
        bike: document.getElementById('bike').value,
        batteryWh: selectedBattery,
        riderWeight: document.getElementById('riderWeight').value,
        bikeWeight: document.getElementById('bikeWeight').value,
        cadence: document.getElementById('cadence').value,
        riderPower: document.getElementById('riderPower').value,
        targetKm: document.getElementById('targetKm').value,
        targetH_m: document.getElementById('targetH_m').value,
        surface: document.getElementById('surface').value,
        reservePercent: document.getElementById('reservePercent').value,
        gradeDistribution: (routeGrades && routeGrades.ok) ? routeGrades.distribution : null,
        climbSummary: (routeGrades && routeGrades.ok) ? routeGrades.climbSummary : null,
        elevationQuality: (routeStats && routeStats.ok) ? routeStats.quality : null
    };

    /* Personal consumption from the calibration: the energy estimate is
       scaled by how the model compares with the real rides it was measured
       on. When the library is still loaded the totals are recomputed live;
       otherwise the totals stored with the calibration are used, so a
       planned route stays personalised (and consistent with the Tuner,
       which applies the same factor). */
    const cal2 = getCalibration();
    if (cal2 && cal2.whPerKm > 0) {
        const realKm = loadedRides.length
            ? loadedRides.reduce((a, r) => a + (((r.samples.at(-1) || {}).distanceKm) || 0), 0)
            : (cal2.realKm || 0);
        const realHm = loadedRides.length
            ? loadedRides.reduce((a, r) => a + (r.metadata.ascent || 0), 0)
            : (cal2.realHm || 0);
        if (realKm > 1) {
            data.realWhPerKm = cal2.whPerKm;
            data.realKm = Math.round(realKm * 10) / 10;
            data.realHm = Math.round(realHm);
        }
    }

    try {
        const response = await axios.post('/api/calculate-mission', data);
        const res = response.data;

        /* Results exist now: show them and hide the empty state. */
        document.getElementById('missionResults').classList.remove('hidden');
        document.getElementById('missionEmpty').classList.add('hidden');

        /* Say which input these numbers describe: a loaded file, a
           recording, or the values typed by hand. */
        const srcEl = document.getElementById('analysisSource');
        if (srcEl) {
            srcEl.innerText = analysisSourceLabel
                ? 'Analysis source: ' + analysisSourceLabel
                : 'Analysis source: manual entry';
        }

        const badge = document.getElementById('energyVerdict');
        if (res.feasible) {
            badge.innerText = 'FEASIBLE';
            badge.className = 'badge badge-ok';
        } else {
            badge.innerText = 'CRITICAL MARATHON';
            badge.className = 'badge badge-warn';
        }

                const en = res.energy;
                /* Say where the personal factor comes from: with the rides
                   loaded it is "your rides", without them it is the stored
                   calibration - and the user is told how to drop it. */
                let scalingNote = '';
                if (res.basedOnRealRides) {
                    const calInfo = getCalibration();
                    const on = calInfo && calInfo.rideLabel ? ' — measured on ' + calInfo.rideLabel : '';
                    scalingNote = callout('info', loadedRides.length
                        ? 'Energy estimate scaled by your rides (×' + res.personalFactor.toFixed(2) + on + ').'
                        : 'Energy estimate scaled by the calibration stored on this device (×' + res.personalFactor.toFixed(2) + on + '); the ride recordings are not loaded. Remove the calibration below to go back to the generic model.');
                }
                document.getElementById('energyBreakdown').innerHTML =
                    scalingNote +
                    kvRow('Estimated use:', `${en.estimated} Wh`, ` <span class="kv-hint">(${en.low}–${en.high} Wh)</span>`) +
            kvRow('Baseline flat + climb:', `${en.base} Wh`, ` <span class="kv-hint">(${en.flat} + ${en.climb})</span>`) +
            kvRow('Corrections:', `surface ×${res.surface.factor.toFixed(2)}, steepness ×${res.steepnessFactor.toFixed(2)}`) +
            kvRow('Usable battery:', `${res.usableWh} Wh`, ` <span class="kv-hint">(${selectedBattery} − ${res.reserve.percent}% reserve)</span>`) +
            kvRow('Safety throttling:', `${(res.scalingFactor * 100).toFixed(0)}%`) +
            kvRow('Confidence:', `${res.confidence}`);

        const ctxPie = document.getElementById('missionPieChart').getContext('2d');
        if (missionPieChartInstance) missionPieChartInstance.destroy();
        const theme = chartTheme();

        missionPieChartInstance = new Chart(ctxPie, {
            type: 'pie',
            data: {
                labels: ['ECO', 'AUTO', 'TRAIL', 'TURBO'],
                datasets: [{
                    data: [res.distribution.eco, res.distribution.auto, res.distribution.trail, res.distribution.turbo],
                    backgroundColor: theme.modeColors,
                    borderWidth: 1,
                    borderColor: theme.surface
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });

        // Phase 3: propose custom modes tailored to this route.
        try {
            const modesResponse = await axios.post('/api/route-modes', data);
            renderRouteModes(modesResponse.data);
        } catch (e) {
            document.getElementById('routeModes').classList.add('hidden');
        }
    } catch(err) {
        alert('Mission analysis failed.');
    }
});

window.addEventListener('DOMContentLoaded', () => {
    restoreForm();
    updateSetup();
    initCalibration();
    initKbDialog();
    initResetDefaults();
    initChartModal();
    initRideSummaryDialog();
    initAppReset();
    initInstallButton();
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support unavailable */ });
    }
});

/* Analyse one recorded ride as the route: build the same track data a
   GPX/KML import would produce (stats, grade distribution, elevation
   profile) from that ride's GPS, then run the analysis. Merging several
   rides into one track would concatenate unrelated recordings (huge fake
   gaps) and break the grade analysis, so it is one at a time. */
function analyzeSelectedRide(index) {
    if (!loadedRides.length) return;
    const i = (typeof index === 'number' && loadedRides[index]) ? index : Math.min(selectedRideIndex, loadedRides.length - 1);
    const ride = loadedRides[i];
    if (!ride) return;
    selectedRideIndex = i;

    /* GPS track of the ride, in the format route-file.js uses. */
    const points = [];
    ride.samples.forEach((s) => {
        if (Number.isFinite(s.latitude) && Number.isFinite(s.longitude)) {
            points.push({
                lat: s.latitude,
                lon: s.longitude,
                ele: Number.isFinite(s.altitude) ? s.altitude : null
            });
        }
    });

    if (points.length > 1 && typeof AvinoxRoute !== 'undefined') {
        routeStats = AvinoxRoute.computeStats(points);
        routeGrades = AvinoxRoute.computeGradeStats(points);
        analysisSourceLabel = ride.label || 'recorded ride';
        /* Fill distance/elevation and render the profile + grade analysis
           exactly as a file import would. */
        renderFileSummary();
        renderElevationChart([{ name: ride.label || 'ride', points: points }]);
        renderRouteAnalysis();
    } else {
        const realKm = (ride.samples.at(-1) || {}).distanceKm || 0;
        const realHm = ride.metadata.ascent || 0;
        if (realKm > 0.1) document.getElementById('targetKm').value = (Math.round(realKm * 10) / 10).toFixed(1);
        if (realHm > 0) document.getElementById('targetH_m').value = Math.round(realHm);
        analysisSourceLabel = ride.label || 'recorded ride';
    }

    document.getElementById('missionForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

/* Popup shown right after rides are parsed: explains what changed, shows
   the before/after of the estimates and offers the riding-style action. */
function showRideSummary(before, after, analysis) {
    const dlg = document.getElementById('rideSummaryDialog');
    const body = document.getElementById('rideSummaryBody');
    if (!dlg || !body || !after) return;
    const s = analysis.summary;
    const modes = [['eco', 'ECO'], ['auto', 'AUTO'], ['trail', 'TRAIL'], ['turbo', 'TURBO']];
    const rows = before ? modes.map(([k, label]) =>
        '<tr><td>' + label + '</td><td>' + before[k].range + ' km</td>' +
        '<td><strong>' + after[k].range + ' km</strong></td></tr>').join('') : '';

    body.innerHTML =
        '<p class="ride-summary-lead">Your rides are now the basis for the range and runtime estimates.</p>' +
        '<div class="kv"><div class="kv-row"><span class="kv-label">Measured consumption</span>' +
        '<span class="kv-value">' + (s.whPerKm ?? '?') + ' Wh/km</span></div>' +
        '<div class="kv-row"><span class="kv-label">Distance analyzed</span>' +
        '<span class="kv-value">' + s.distanceKm + ' km · ' + loadedRides.length + ' ride(s)</span></div>' +
        '<div class="kv-row"><span class="kv-label">Your riding style</span>' +
        '<span class="kv-value">' + (s.avgCadence ?? '?') + ' RPM · ' + (s.avgRiderPower ?? '?') + ' W</span></div></div>' +
        (rows ? '<table class="kb-table ride-summary-table"><thead><tr><th>Mode</th><th>Standard</th><th>Your rides</th></tr></thead><tbody>' + rows + '</tbody></table>' : '') +
        '<p class="hint">"Use my riding style" also copies your real cadence and power into the Tuner, so the suggested levels match how you actually ride.</p>';

    if (typeof dlg.showModal === 'function') dlg.showModal();
}

function initRideSummaryDialog() {
    const dlg = document.getElementById('rideSummaryDialog');
    if (!dlg) return;
    const close = () => dlg.close();
    document.getElementById('rideSummaryClose').addEventListener('click', close);
    document.getElementById('rideSummaryView').addEventListener('click', () => {
        close();
        document.getElementById('rideInsights').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('rideSummaryApply').addEventListener('click', () => {
        const s = lastRideAnalysis && lastRideAnalysis.summary;
        if (s && s.avgCadence && s.avgRiderPower) {
            document.getElementById('cadence').value = s.avgCadence;
            document.getElementById('riderPower').value = s.avgRiderPower;
            saveForm();
            updateSetup();
        }
        close();
        switchTab('calc');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

/* PWA install button: mobile only. Chrome/Android fires
   beforeinstallprompt and we trigger it; iOS Safari cannot be prompted,
   so the button shows the Add-to-Home-Screen instructions instead. */
function initInstallButton() {
    const btn = document.getElementById('installApp');
    if (!btn) return;
    const ua = navigator.userAgent;
    const isMobile = (navigator.userAgentData && navigator.userAgentData.mobile)
        || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    const standalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    if (!isMobile || standalone) return; // desktop or already installed

    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferred = e;
        btn.classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => btn.classList.add('hidden'));

    const isIos = /iPhone|iPad|iPod/i.test(ua);
    if (isIos) btn.classList.remove('hidden'); // instructions path

    btn.addEventListener('click', async () => {
        if (deferred) {
            deferred.prompt();
            try { await deferred.userChoice; } catch (e) { /* ignore */ }
            deferred = null;
            btn.classList.add('hidden');
            return;
        }
        showInstallHint();
    });
}

function showInstallHint() {
    const existing = document.getElementById('installHint');
    if (existing) { existing.remove(); return; }
    const el = document.createElement('div');
    el.id = 'installHint';
    el.className = 'install-hint';
    el.innerHTML = 'To install: tap <strong>Share</strong> in the browser, then <strong>Add to Home Screen</strong>.';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 8000);
}

/* Reset the rider form to the project defaults (useful after applying
   ride averages from the calibration). */
const FORM_DEFAULTS = {
    bike: 'M2S', batteryWh: '800', boostDuration: '30',
    riderWeight: '82', bikeWeight: '23', cadence: '75', riderPower: '200',
    ecoWkg: '1.36', autoWkg: '2.73', trailWkg: '5.45', turboWkg: '7.72'
};

function applyFormDefaults() {
    Object.entries(FORM_DEFAULTS).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });
}

function initResetDefaults() {
    const btn = document.getElementById('resetDefaults');
    if (!btn) return;
    btn.addEventListener('click', () => {
        applyFormDefaults();
        saveForm();
        updateSetup();
    });
}

/* Drop the loaded ride library: charts, map, selector and the ride-derived
   analysis. The calibration is NOT touched - it is a measurement stored on
   the device, not part of the loaded files (see resetApp for a full wipe). */
function clearRides() {
    loadedRides = [];
    selectedRideIndex = 0;
    graphOrder = null;
    rideCharts.forEach((c) => c.destroy());
    rideCharts = [];
    if (modalChart) { modalChart.destroy(); modalChart = null; }
    if (rideMap) { rideMap.remove(); rideMap = null; }
    rideMapPoints = [];
    lastRideAnalysis = null;
    const graphs = document.getElementById('rideGraphs');
    if (graphs) graphs.innerHTML = '';
    const picker = document.getElementById('rideSelector');
    if (picker) picker.innerHTML = '';
    const mapLegend = document.getElementById('mapLegend');
    if (mapLegend) mapLegend.innerHTML = '';
    const ridePicker = document.getElementById('ridePickerRow');
    if (ridePicker) ridePicker.classList.add('hidden');
    const calReport = document.getElementById('calibrationReport');
    if (calReport) calReport.innerHTML = '';
    const rideMapBox = document.getElementById('rideMap');
    if (rideMapBox) rideMapBox.innerHTML = '';
    renderCalibrationState();
    renderRideInsights();
}

/* Drop the loaded route file: geometry picker, file summary and the track
   it contributed. The analysis panel is refilled by whoever loads next. */
function clearRouteFile() {
    parsedRoute = null;
    selectedGeometries = [];
    routeFileName = null;
    const summary = document.getElementById('fileSummary');
    if (summary) summary.innerHTML = '';
    ['geometryPanel', 'geometryPicker', 'fileSummary']
        .forEach((id) => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
}

/* Clear all: drop the loaded rides, the calibration and reset the form. */
/* Total reset: rides, calibration, route analysis, forms and saved
   settings. Reachable from the Route tab and from the ? dialog. */
function resetApp() {
    if (!window.confirm('Reset the app to defaults? This removes the loaded rides, the calibration, the route analysis and any saved settings.')) return;

    try {
        ['avinox-form', 'avinox-calibration', 'avinox-graph-order', 'avinox-pinned-graphs']
            .forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }

    /* Rides (the calibration is in localStorage and is removed above). */
    clearRides();
    lastCalcRes = null;

    /* Route / analysis */
    clearRouteFile();
    routeStats = null;
    routeGrades = null;
    analysisSourceLabel = null;
    const srcLabel = document.getElementById('analysisSource');
    if (srcLabel) srcLabel.innerText = '';
    const missionResults = document.getElementById('missionResults');
    if (missionResults) missionResults.classList.add('hidden');
    const missionEmpty = document.getElementById('missionEmpty');
    if (missionEmpty) missionEmpty.classList.remove('hidden');
    ['routeAnalysis', 'routeModes', 'elevationPanel', 'fileSummary', 'geometryPanel', 'geometryPicker']
        .forEach((id) => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    const verdict = document.getElementById('energyVerdict');
    if (verdict) { verdict.innerText = '--'; verdict.className = 'badge badge-soft'; }
    const breakdown = document.getElementById('energyBreakdown');
    if (breakdown) breakdown.innerHTML = 'Enter route parameters and execute the analysis to compute the electrical projection.';
    ['gradeBars', 'climbList', 'routeModesGrid', 'routeModeNotes'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
    const routeFile = document.getElementById('routeFileInput');
    if (routeFile) routeFile.value = '';
    const fileStatus = document.getElementById('fileStatus');
    if (fileStatus) { fileStatus.className = 'file-status'; fileStatus.innerText = ''; }
    const targetKm = document.getElementById('targetKm');
    if (targetKm) targetKm.value = '70';
    const targetH = document.getElementById('targetH_m');
    if (targetH) targetH.value = '1500';
    const surface = document.getElementById('surface');
    if (surface) surface.value = 'mixed';
    const reserve = document.getElementById('reservePercent');
    if (reserve) reserve.value = '15';

    /* Tuner */
    applyFormDefaults();
    if (typeof updateSetup === 'function') updateSetup();

    renderCalibrationState();
    renderRideInsights();
}

/* Full reset: one global action, in the header (the Route tab and the
   Knowledge Base no longer carry their own copy). */
function initAppReset() {
    const btn = document.getElementById('resetAppBtn');
    if (btn) btn.addEventListener('click', resetApp);
}

/* Enlarged chart modal. */
function initChartModal() {
    const dlg = document.getElementById('chartModal');
    const closeBtn = document.getElementById('chartModalClose');
    if (!dlg || !closeBtn) return;
    closeBtn.addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => {
        if (modalChart) { modalChart.destroy(); modalChart = null; }
    });
}

/* Knowledge Base as a modal dialog (like the ARE "?" button). */
function initKbDialog() {
    const dlg = document.getElementById('tabGuide');
    const openBtn = document.getElementById('kbOpenBtn');
    const closeBtn = document.getElementById('kbCloseBtn');
    if (!dlg || !document.getElementById('kbOpenBtn')) return;
    document.getElementById('kbOpenBtn').addEventListener('click', () => {
        if (typeof dlg.showModal === 'function') dlg.showModal();
        else dlg.setAttribute('open', '');
    });
    const close = document.getElementById('kbCloseBtn');
    if (close) close.addEventListener('click', () => dlg.close());
    dlg.querySelectorAll('.kb-nav a').forEach((a) => {
        a.addEventListener('click', () => { if (dlg.open) dlg.close(); });
    });
}

/* Theme toggle (dark variant): persists the choice and re-renders the
   charts, which read their colours from the CSS custom properties. */
(function initThemeToggle() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const root = document.documentElement;
    const apply = (theme) => {
        root.setAttribute('data-theme', theme);
        btn.querySelector('.tt-icon').textContent = theme === 'dark' ? '☼' : '☾';
        btn.querySelector('.tt-label').textContent = theme === 'dark' ? 'Light' : 'Dark';
        btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', theme === 'dark' ? '#1A1E23' : '#F2F0E8');
    };
    const stored = localStorage.getItem('avinox-theme');
    apply(stored === 'dark' || stored === 'light' ? stored : root.getAttribute('data-theme') || 'light');
    btn.addEventListener('click', () => {
        const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('avinox-theme', next); } catch (e) { /* ignore */ }
        apply(next);
        if (typeof updateSetup === 'function') updateSetup();
    });
})();

/* Route Simulator chip (E1): shows which motor/battery the mission analysis
   inherits from the Engine Tuner form. Read-only — no effect on the math. */
(function initSetupChip() {
    const chip = document.getElementById('missionSetupChip');
    if (!chip) return;
    const update = () => {
        const bike = document.getElementById('bike');
        const battery = document.getElementById('batteryWh');
        if (!bike || !battery) return;
        chip.innerText = 'Using ' + bike.value + ' · ' + battery.value +
            ' Wh — set in Engine Tuner';
    };
    document.getElementById('bike').addEventListener('change', update);
    document.getElementById('batteryWh').addEventListener('change', update);
    update();
})();

function switchTab(tabName) {
    const workspaces = {
        calc: { tab: document.getElementById('tabCalc'), button: document.getElementById('tabCalcBtn') },
        route: { tab: document.getElementById('tabRoute'), button: document.getElementById('tabRouteBtn') }
    };

            Object.keys(workspaces).forEach((key) => {
                const active = key === tabName;
                workspaces[key].tab.classList.toggle('hidden', !active);
                workspaces[key].tab.classList.toggle('block', active);
                workspaces[key].button.classList.toggle('is-active', active);
                workspaces[key].button.setAttribute('aria-selected', active ? 'true' : 'false');
            });

            // The selected tab starts from its top: otherwise switching while
            // scrolled down lands mid-content (e.g. past the KB index).
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
