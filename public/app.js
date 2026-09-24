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
    const report = document.getElementById('calibrationReport');
    if (!badge || !report) return;
    const cal = getCalibration();
    const note = document.getElementById('calibrationNote');
    if (cal) {
        badge.classList.remove('hidden');
        badge.innerText = 'estimates ×' + (1 / cal.factor).toFixed(2);
        if (note) {
            note.classList.remove('hidden');
            note.innerText = 'Personal estimates — calibrated ×' + (1 / cal.factor).toFixed(2) +
                ' on your rides (' + cal.actualWh + ' Wh real vs ' + cal.modelWh + ' Wh predicted).';
        }
        report.classList.remove('hidden');
        report.innerHTML =
            '<div class="card"><div class="card-body kv-compact">' +
            kvRow('Calibrated on:', cal.rideLabel) +
            kvRow('Real motor energy:', cal.actualWh + ' Wh') +
            kvRow('Model prediction:', cal.modelWh + ' Wh') +
            kvRow('Personal factor:', '×' + cal.factor.toFixed(2)) +
            '</div></div>' +
            '<button type="button" id="calibrationReset" class="mini-btn">Remove calibration</button>';
        document.getElementById('calibrationReset').addEventListener('click', () => setCalibration(null));
    } else {
        badge.classList.add('hidden');
        if (note) note.classList.add('hidden');
        report.classList.add('hidden');
        report.innerHTML = '';
    }
}

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

    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const prev = i > 0 ? samples[i - 1] : null;
        const dt = prev && s.timestamp > prev.timestamp ? Math.min((s.timestamp - prev.timestamp), 10) : 1;
        if (s.battery != null) {
            if (batteryStart === null) batteryStart = s.battery;
            batteryEnd = s.battery;
        }
        distanceKm = Math.max(distanceKm, s.distanceKm || 0);

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
           pedaling — otherwise coasting/stops dilute the averages. */
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
    return {
        summary: {
            fileName: parsed.metadata.fileName,
            date: parsed.metadata.start ? new Date(parsed.metadata.start * 1000).toLocaleString() : '—',
            durationH: (parsed.metadata.duration / 3600).toFixed(2),
            distanceKm: distanceKm.toFixed(1),
            batteryStart, batteryEnd,
            actualWh: Math.round(actualWh),
            modelWh: Math.round(modelWh),
            factor: Math.round(factor * 100) / 100,
            avgRiderPower,
            avgCadence
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

/* ---- Ride Insights (Phase 2A): sensor timelines + energy by level ----- */

let ridePowerChart = null, rideSpeedChart = null, rideBatteryChart = null, rideEnergyChart = null;

function renderRideInsights(parsed, analysis) {
    const wrap = document.getElementById('rideInsights');
    if (!wrap) return;
    wrap.classList.remove('hidden');

    const samples = parsed.samples.filter((s) => s && s.timestamp);
    const t0 = samples[0].timestamp;
    const labels = samples.map((s) => Math.round((s.timestamp - t0) / 60)); // minutes
    const theme = chartTheme();

    const lineOpts = (yTitle) => ({
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { display: true, position: 'top', labels: { color: theme.tick, boxWidth: 12 } },
            tooltip: { callbacks: { title: (items) => 'min ' + items[0].label } }
        },
        scales: {
            x: { grid: { display: false }, ticks: { color: theme.tick, maxTicksLimit: 10, callback: (v) => v + 'm' } },
            y: { grid: { color: theme.grid }, ticks: { color: theme.tick, font: { size: 10 } } }
        }
    });

    const mk = (id, prev, cfg) => {
        const ctx = document.getElementById(cfg.id).getContext('2d');
        if (prev) prev.destroy();
        return new Chart(ctx, cfg.chart);
    };

    ridePowerChart = mk('ridePowerChart', ridePowerChart, {
        id: 'ridePowerChart',
        chart: {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Motor', data: samples.map((s) => s.motorPower), borderColor: theme.modeColors[3], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0.15 },
                    { label: 'Rider', data: samples.map((s) => s.riderPower), borderColor: theme.modeColors[0], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0.15 }
                ]
            },
            options: lineOpts()
        }
    });

    rideSpeedChart = mk('rideSpeedChart', rideSpeedChart, {
        id: 'rideSpeedChart',
        chart: {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Speed km/h', data: samples.map((s) => s.speed), borderColor: theme.modeColors[1], backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0.15 },
                    { label: 'Cadence RPM', data: samples.map((s) => s.cadence), borderColor: theme.modeColors[1], backgroundColor: 'transparent', borderWidth: 1, borderDash: [4, 3], pointRadius: 0, tension: 0.15 }
                ]
            },
            options: lineOpts()
        }
    });

    rideBatteryChart = mk('rideBatteryChart', rideBatteryChart, {
        id: 'rideBatteryChart',
        chart: {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Battery %', data: samples.map((s) => s.battery), borderColor: theme.accent, backgroundColor: theme.accentFill, borderWidth: 1.5, pointRadius: 0, tension: 0.15, yAxisID: 'y' },
                    { label: 'Assist level', data: samples.map((s) => s.assist), borderColor: theme.modeColors[2], backgroundColor: 'transparent', borderWidth: 1, stepped: true, pointRadius: 0, yAxisID: 'y1' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'top', labels: { color: theme.tick, boxWidth: 12 } } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: theme.tick, maxTicksLimit: 10, callback: (v) => v + 'm' } },
                    y: { min: 0, max: 100, grid: { color: theme.grid }, ticks: { color: theme.tick, font: { size: 10 } } }
                }
            }
        }
    });

    /* Energy by assist level: where the battery actually went. */
    const levels = analysis.levels;
    rideEnergyChart = mk('rideEnergyChart', rideEnergyChart, {
        id: 'rideEnergyChart',
        chart: {
            type: 'bar',
            data: {
                labels: levels.map((l) => 'L' + l.level),
                datasets: [{ label: 'Motor energy (Wh)', data: levels.map((l) => Math.round(l.motorWh)), backgroundColor: theme.modeColors, borderRadius: 4 }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: theme.tick, font: { size: 10, weight: 'bold' } } },
                    y: { grid: { color: theme.grid }, ticks: { color: theme.tick, font: { size: 10 } } }
                }
            }
        }
    });
}

function initCalibration() {
    const btn = document.getElementById('protoLoadBtn');
    const input = document.getElementById('protoInput');
    const status = document.getElementById('calibrationStatus');
    if (!btn || !input) return;

    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
        const files = Array.from(input.files || []);
        if (!files.length) return;
        try {
            status.className = 'file-status status-info';
            status.innerText = 'Reading ' + files.length + ' file(s)…';

            const rides = [];
            for (const file of files) {
                const buf = await file.arrayBuffer();
                rides.push(AvinoxProtoParser.parse(buf, file.name));
            }

            /* Merge all rides into one analysis: more rides, better factor. */
            const allSamples = rides.flatMap((r) => r.samples);
            const earliest = rides.reduce((m, r) => Math.min(m, r.metadata.start), Infinity);
            const merged = {
                metadata: {
                    fileName: files.length + ' ride file(s)',
                    start: earliest,
                    duration: rides.reduce((m, r) => m + r.metadata.duration, 0),
                    samples: allSamples.length
                },
                samples: allSamples
            };

            const analysis = analyzeRideForCalibration(merged);
            const cal = {
                factor: analysis.summary.factor,
                actualWh: analysis.summary.actualWh,
                modelWh: analysis.summary.modelWh,
                rideLabel: files.length + ' ride(s) · ' + analysis.summary.distanceKm + ' km'
            };
            setCalibration(cal);
            status.className = 'file-status status-ok';
            status.innerText = 'Parsed ' + rides.length + ' ride(s), ' + allSamples.length + ' samples.';
            renderCalibrationReport(analysis);
            renderRideInsights(merged, analysis);
        } catch (err) {
            status.className = 'file-status status-error';
            status.innerText = err.message;
        }
        input.value = '';
    });
    renderCalibrationState();
}

let lastRideAnalysis = null;

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
        kvRow('Duration / distance:', s.durationH + ' h / ' + s.distanceKm + ' km') +
        kvRow('Battery start / finish:', (s.batteryStart ?? '—') + ' / ' + (s.batteryEnd ?? '—') + ' %') +
        kvRow('Your real averages:', (s.avgCadence ?? '—') + ' RPM · ' + (s.avgRiderPower ?? '—') + ' W (while pedaling)') +
        kvRow('Real motor energy:', s.actualWh + ' Wh') +
        kvRow('Model prediction:', s.modelWh + ' Wh') +
        kvRow('Personal factor:', '×' + s.factor.toFixed(2)) +
        '</div></div>' +
        '<div class="kb-table-wrap"><table class="kb-table"><thead><tr>' +
        '<th>Level</th><th>Time</th><th>Rider W (riding)</th><th>Motor W (riding)</th><th>Rider W (total)</th><th>Energy</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<button type="button" id="useRideAverages" class="btn btn-ghost btn-sm"' +
        ((s.avgCadence && s.avgRiderPower) ? '' : ' disabled') + '>Use ride averages' +
        ((s.avgCadence && s.avgRiderPower) ? ' (' + s.avgCadence + ' RPM · ' + s.avgRiderPower + ' W)' : '') +
        '</button>' +
        '<p class="hint">Estimates are now scaled by 1/' + s.factor.toFixed(2) + ' = ×' + (1 / s.factor).toFixed(2) + '. Remove the calibration to return to the generic model.</p>';
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

    try {
        const response = await axios.post('/api/calculate', data);
        const res = response.data;
        saveForm();
        const cal = getCalibration();
        const calFactor = cal ? 1 / cal.factor : 1;
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
            const calHint = calFactor !== 1
                ? ` <span class="kv-hint">· estimates ×${calFactor.toFixed(2)} (calibrated)</span>` : '';
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
            [res.eco.range, res.auto.range, res.trail.range, res.turbo.range].map((v) => v * calFactor),
            [res.eco.runtime, res.auto.runtime, res.trail.runtime, res.turbo.runtime].map((v) => v * calFactor)
        );
        initStockChart(
            res.stock || [],
            [res.eco.runtime, res.auto.runtime, res.trail.runtime, res.turbo.runtime].map((v) => v * calFactor)
        );
    } catch (err) {
        console.error(err);
    }
}

/* ==================================================================
 * Route file import (GPX / KML)
 * Parsing happens entirely in the browser: coordinates never leave
 * the device. Only distance and elevation gain are sent to the API.
 * ================================================================== */

let routeSource = 'manual';
let parsedRoute = null;       // { source, geometries, warnings }
let selectedGeometries = [];  // indices into parsedRoute.geometries
let routeStats = null;
let routeGrades = null;       // grade distribution + climbs
let elevationChartInstance = null;

function setRouteSource(mode) {
    routeSource = mode;
    const fileBlock = document.getElementById('fileSource');
    const manualBtn = document.getElementById('srcManualBtn');
    const fileBtn = document.getElementById('srcFileBtn');

    if (mode === 'manual') {
        fileBlock.classList.add('hidden');
        manualBtn.classList.add('is-active');
        fileBtn.classList.remove('is-active');
        manualBtn.setAttribute('aria-pressed', 'true');
        fileBtn.setAttribute('aria-pressed', 'false');
    } else {
        fileBlock.classList.remove('hidden');
        manualBtn.classList.remove('is-active');
        fileBtn.classList.add('is-active');
        manualBtn.setAttribute('aria-pressed', 'false');
        fileBtn.setAttribute('aria-pressed', 'true');
    }
}

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

    setFileStatus(parsedRoute.source.toUpperCase() + ' parsed — ' +
        parsedRoute.geometries.length + ' geometry(ies) found.', 'ok');

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

    renderFileSummary();
    renderElevationChart(chosen);
    renderRouteAnalysis();
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

(function initRouteFileInput() {
    const drop = document.getElementById('dropZone');
    const input = document.getElementById('routeFileInput');
    if (!drop || !input) return;

    drop.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        if (input.files && input.files[0]) handleRouteFile(input.files[0]);
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
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleRouteFile(f);
    });
})();

document.getElementById('missionForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (routeSource === 'file' && (!routeStats || !routeStats.ok)) {
        alert('Load a GPX or KML file first, or switch back to Manual.');
        return;
    }

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

    try {
        const response = await axios.post('/api/calculate-mission', data);
        const res = response.data;
        
        const badge = document.getElementById('energyVerdict');
        if (res.feasible) {
            badge.innerText = 'FEASIBLE';
            badge.className = 'badge badge-ok';
        } else {
            badge.innerText = 'CRITICAL MARATHON';
            badge.className = 'badge badge-warn';
        }

        const en = res.energy;
        document.getElementById('energyBreakdown').innerHTML =
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

        const mGrid = document.getElementById('missionGrid');
        mGrid.innerHTML = '';

        const mModes = [
            { name: 'MISSION ECO', key: 'eco', data: res.eco },
            { name: 'MISSION AUTO', key: 'auto', data: res.auto },
            { name: 'MISSION TRAIL', key: 'trail', data: res.trail },
            { name: 'MISSION TURBO', key: 'turbo', data: res.turbo }
        ];

        mModes.forEach(m => {
            mGrid.innerHTML += modeCard({
                mode: m.key,
                title: m.name,
                badges: [`<span class="badge badge-mode-${m.key}">${m.data.wkg} W/kg</span>`],
                rows: [
                    kvRow('Assist Bound:', `${m.data.level}${m.data.levelPct ? ` <span class="kv-hint">· ${m.data.levelPct} of rider input</span>` : ''}`),
                    kvRow('Power Limit:', m.data.watts),
                    kvRow('Max Torque:', m.data.torque)
                ]
            });
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
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support unavailable */ });
    }
});

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
        mission: { tab: document.getElementById('tabMission'), button: document.getElementById('tabMissionBtn') },
        guide: { tab: document.getElementById('tabGuide'), button: document.getElementById('tabGuideBtn') }
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
