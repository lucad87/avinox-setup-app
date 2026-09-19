        let rangeChartInstance = null;
        let runtimeChartInstance = null;
        let missionPieChartInstance = null;

        function toggleAdvancedSliders() {
            const panel = document.getElementById('advancedSlidersPanel');
            const txt = document.getElementById('advancedToggleText');
            const icon = document.getElementById('advancedToggleIcon');
            
            if(panel.classList.contains('hidden')) {
                panel.classList.remove('hidden');
                txt.innerText = "Hide Advanced Sliders";
                icon.innerText = "✖️";
            } else {
                panel.classList.add('hidden');
                txt.innerText = "Show Advanced W/kg Sliders";
                icon.innerText = "🛠️";
            }
        }

        function initCharts(rangeData, runtimeData) {
            const ctxRange = document.getElementById('rangeChart').getContext('2d');
            const ctxRuntime = document.getElementById('runtimeChart').getContext('2d');

            const chartOptions = {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { grid: { color: '#1F2937' }, ticks: { color: '#6B7280', font: { size: 10 } } },
                    x: { ticks: { color: '#9CA3AF', font: { size: 10, weight: 'bold' } } }
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
                        backgroundColor: ['#10B981', '#3B82F6', '#F59E0B', '#EF4444'],
                        borderRadius: 6
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
                        backgroundColor: ['#10B981', '#3B82F6', '#F59E0B', '#EF4444'],
                        borderRadius: 6
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
                document.getElementById('sysWeight').innerText = 'Total Weight: ' + res.totalWeight + ' kg';
                
                const modes = [
                    { name: 'ECO', color: 'green', val: parseFloat(data.ecoWkg), data: res.eco, desc: 'Maximum range baseline profile.' },
                    { name: 'AUTO', color: 'blue', val: parseFloat(data.autoWkg), data: res.auto, desc: 'Dynamic torque adjustments matching slopes.' },
                    { name: 'TRAIL', color: 'yellow', val: parseFloat(data.trailWkg), data: res.trail, desc: 'Optimized technical climbing engagement map.' },
                    { name: 'TURBO', color: 'red', val: parseFloat(data.turboWkg), data: res.turbo, desc: 'Peak emergency boost map.' }
                ];

                const grid = document.getElementById('resultsGrid');
                grid.innerHTML = '';
                modes.forEach(m => {
                    const isHighDrain = m.val >= 6.0;
                    const badgeClass = isHighDrain ? 'bg-red-600 text-white animate-pulse' : `bg-gray-950 text-${m.color}-400 border border-gray-800`;
                    const typeBadge = m.data.type === 'range'
                        ? '<span class="text-xxs bg-gray-950 text-gray-300 px-2 py-0.5 rounded-md uppercase font-bold border border-gray-800">Range</span>'
                        : '<span class="text-xxs bg-gray-950 text-gray-300 px-2 py-0.5 rounded-md uppercase font-bold border border-gray-800">Fixed</span>';
                    const accelRow = m.data.maxAccel !== null && m.data.maxAccel !== undefined
                        ? `<p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Max Acceleration:</span> <span>${m.data.maxAccel}</span></p>`
                        : '';
                    const warnBlock = (m.data.warnings && m.data.warnings.length)
                        ? `<p class="text-xxs text-red-300 bg-red-950 border border-red-900 rounded-lg p-2 mt-2">${m.data.warnings.join(' ')}</p>`
                        : '';
                    const powerHint = (m.data.idealPower !== m.data.maxPower)
                        ? ` <span class="text-gray-500 text-xxs">(computed ${m.data.idealPower} W)</span>` : '';
                    const torqueHint = (m.data.idealTorque !== m.data.maxTorque)
                        ? ` <span class="text-gray-500 text-xxs">(computed ${m.data.idealTorque} Nm)</span>` : '';
                    grid.innerHTML += `
                        <div class="bg-gray-800 p-4 rounded-xl border ${isHighDrain ? 'border-red-500' : 'border-gray-700'} flex flex-col justify-between text-xs shadow-md">
                            <div>
                                <div class="flex justify-between items-center mb-2.5">
                                    <span class="font-black text-sm text-white tracking-wide">${m.name}</span>
                                    <div class="flex items-center gap-1">
                                        ${typeBadge}
                                        <span class="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${badgeClass}">${m.data.wkg} W/kg</span>
                                    </div>
                                </div>
                                <div class="space-y-1.5 mb-2">
                                    <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Assist Bound:</span> <span>${m.data.level}</span></p>
                                    <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Power Limit:</span> <span>${m.data.watts}${powerHint}</span></p>
                                    <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Max Torque:</span> <span>${m.data.torque}${torqueHint}</span></p>
                                    <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Max Overrun:</span> <span>${m.data.maxOverrun}</span></p>
                                    <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Assist Start:</span> <span>${m.data.assistStart}</span></p>
                                    <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Continued Assist:</span> <span>${m.data.continuedAssist}</span></p>
                                    ${accelRow}
                                </div>
                                ${warnBlock}
                            </div>
                            <p class="text-xxs text-gray-500 border-t border-gray-700 pt-1.5 italic mt-1">${m.desc}</p>
                        </div>
                    `;
                });

                const warnBox = document.getElementById('calcWarnings');
                warnBox.innerHTML = (res.warnings && res.warnings.length)
                    ? res.warnings.map(w => `<div class="bg-yellow-950 border border-yellow-800 text-yellow-200 text-xs rounded-xl p-3 mb-4">⚠️ ${w}</div>`).join('')
                    : '';

                const b = res.boost;
                document.getElementById('boostCard').innerHTML = `
                    <div class="bg-gray-900 p-5 rounded-2xl border border-gray-800 shadow-xl text-xs">
                        <div class="flex justify-between items-center mb-3 border-b border-gray-800 pb-2">
                            <span class="font-black text-sm text-purple-400 tracking-wide">BOOST</span>
                            <span class="text-xxs bg-gray-950 text-gray-300 px-2 py-0.5 rounded-md uppercase font-bold border border-gray-800">Torque / power fixed · duration adjustable</span>
                        </div>
                        <div class="grid grid-cols-3 gap-3">
                            <div><span class="block text-gray-400 text-xxs uppercase font-bold">Torque</span><span class="font-bold text-gray-100">${b.torque} Nm</span></div>
                            <div><span class="block text-gray-400 text-xxs uppercase font-bold">Power</span><span class="font-bold text-gray-100">${b.power} W${b.fullPowerAvailable ? '' : ' (FP700 only)'}</span></div>
                            <div><span class="block text-gray-400 text-xxs uppercase font-bold">Duration</span><span class="font-bold text-gray-100">${b.duration} s</span></div>
                        </div>
                        <p class="text-xxs text-gray-500 mt-2">Adjustable ${b.durationMin}–${b.durationMax} s (default ${b.durationDefault} s).</p>
                        ${b.note ? `<p class="text-xxs text-gray-500 mt-1">${b.note}</p>` : ''}
                    </div>`;

                initCharts(
                    [res.eco.range, res.auto.range, res.trail.range, res.turbo.range],
                    [res.eco.runtime, res.auto.runtime, res.trail.runtime, res.turbo.runtime]
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
            const colors = { error: 'text-red-400', ok: 'text-green-400', info: 'text-gray-400' };
            el.className = 'text-xxs ' + (colors[kind] || colors.info);
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
            const box = document.getElementById('geometryPicker');
            if (!parsedRoute || parsedRoute.geometries.length < 2) {
                box.classList.add('hidden');
                box.innerHTML = '';
                return;
            }
            box.classList.remove('hidden');

            const total = parsedRoute.geometries.length;
            box.innerHTML = `
                <div class="flex items-center justify-between gap-2">
                    <p id="geomCounter" class="text-xxs font-bold uppercase text-gray-400">${selectedGeometries.length} of ${total} segments selected</p>
                    <div class="flex gap-1 shrink-0">
                        <button type="button" id="geomAll" class="text-xxs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-0.5 rounded">All</button>
                        <button type="button" id="geomNone" class="text-xxs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-0.5 rounded">First only</button>
                    </div>
                </div>` +
                parsedRoute.geometries.map((g, i) => `
                    <label class="flex items-center gap-2 text-xxs bg-gray-950 border border-gray-800 rounded-lg p-2 cursor-pointer">
                        <input type="checkbox" data-geom="${i}" ${selectedGeometries.indexOf(i) >= 0 ? 'checked' : ''} class="accent-green-500">
                        <span class="text-gray-300 flex-1">${escapeHtml(g.name)}</span>
                        <span class="text-gray-500">${(geometryDistance(g) / 1000).toFixed(1)} km</span>
                    </label>`).join('');

            const updateCounter = () => {
                const el = document.getElementById('geomCounter');
                if (el) el.innerText = selectedGeometries.length + ' of ' + total + ' segments selected';
            };

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
                descent: '#3B82F6', flat: '#10B981', rolling: '#84CC16',
                climb: '#F59E0B', steep: '#EF4444', extreme: '#7C3AED'
            };
            const d = routeGrades.distribution;

            bars.innerHTML = AvinoxRoute.gradeBands.map((b) => {
                const pct = d[b.key] || 0;
                return `
                    <div class="flex items-center gap-2 text-xxs mb-1">
                        <span class="w-16 text-gray-400 font-bold uppercase">${b.label}</span>
                        <div class="flex-1 bg-gray-950 rounded h-3 overflow-hidden border border-gray-800">
                            <div style="width:${pct.toFixed(1)}%;background:${colors[b.key]}" class="h-full"></div>
                        </div>
                        <span class="w-10 text-right text-gray-300">${pct.toFixed(0)}%</span>
                    </div>`;
            }).join('');

            const cs = routeGrades.climbSummary;
            climbs.innerHTML = cs.count
                ? `<p class="text-xxs text-gray-400 mt-2">${cs.count} climb(s) · median grade ${cs.medianGrade.toFixed(1)}% ·
                   longest ${cs.longestKm.toFixed(1)} km · peak ${routeGrades.maxGrade.toFixed(1)}%</p>`
                : '<p class="text-xxs text-gray-400 mt-2">No sustained climbs detected.</p>';
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
            grid.className = 'grid gap-4 ' + (
                count >= 4 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4' :
                count === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' :
                count === 2 ? 'grid-cols-1 sm:grid-cols-2' :
                'grid-cols-1'
            );

            grid.innerHTML = res.modes.map((m) => `
                <div class="bg-gray-800 p-4 rounded-xl border border-gray-700 text-xs shadow-md">
                    <div class="flex justify-between items-center mb-2">
                        <span class="font-black text-sm text-white tracking-wide text-purple-400">${m.label}</span>
                        <span class="text-xxs bg-gray-950 text-gray-300 px-2 py-0.5 rounded-md uppercase font-bold border border-gray-800">Fixed</span>
                    </div>
                    <div class="space-y-1.5">
                        <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Assist Level:</span> <span>${m.assistLevel}</span></p>
                        <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Max Power:</span> <span>${m.maxPower} W</span></p>
                        <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Max Torque:</span> <span>${m.maxTorque} Nm</span></p>
                        <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Max Overrun:</span> <span>${m.maxOverrun}</span></p>
                        <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Assist Start:</span> <span>${m.assistStart}</span></p>
                        <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Continued Assist:</span> <span>${m.continuedAssist}</span></p>
                    </div>
                    <p class="text-xxs text-gray-500 border-t border-gray-700 pt-1.5 italic mt-2">${escapeHtml(m.rationale)}</p>
                    <button type="button" data-copy-mode="${m.key}"
                        class="mt-2 w-full text-xxs bg-gray-950 hover:bg-gray-900 text-gray-200 font-bold py-1.5 px-2 rounded-lg uppercase tracking-wider">Copy</button>
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
                box.innerHTML = '<div class="bg-red-950 border border-red-900 text-red-300 text-xxs rounded-lg p-2">' +
                    escapeHtml(routeStats ? routeStats.error : 'Could not analyse the route.') + '</div>';
                return;
            }

            const s = routeStats;
            const eleOk = s.elevationStatus === 'available';
            const qualityColor = { good: 'text-green-400', noisy: 'text-yellow-400', unavailable: 'text-red-400' }[s.quality];
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
                <div class="bg-gray-950 border border-gray-800 rounded-xl p-3 space-y-1">
                    ${rows.map((r) => `<p class="text-xxs flex justify-between"><span class="text-gray-500 font-bold">${r[0]}</span><span class="text-gray-200">${r[1]}</span></p>`).join('')}
                    <p class="text-xxs flex justify-between"><span class="text-gray-500 font-bold">Elevation quality</span><span class="${qualityColor}">${qualityLabel}</span></p>
                </div>
                ${allWarnings.length ? `<div class="bg-yellow-950 border border-yellow-900 text-yellow-200 text-xxs rounded-lg p-2 mt-2 space-y-1">${allWarnings.map((w) => '<p>⚠️ ' + escapeHtml(w) + '</p>').join('')}</div>` : ''}
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

            elevationChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [{
                        data: points,
                        borderColor: '#10B981',
                        backgroundColor: 'rgba(16, 185, 129, 0.15)',
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
                            grid: { color: '#1F2937' },
                            ticks: {
                                color: '#6B7280', font: { size: 9 }, maxTicksLimit: 8,
                                callback: (value) => (Math.round(value * 10) / 10) + ' km'
                            }
                        },
                        y: {
                            grid: { color: '#1F2937' },
                            ticks: { color: '#6B7280', font: { size: 9 } }
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
                    badge.className = 'px-2.5 py-1 rounded-md text-xxs font-black uppercase tracking-wider bg-green-955 text-green-300 border-green-900';
                } else {
                    badge.innerText = 'CRITICAL MARATHON';
                    badge.className = 'px-2.5 py-1 rounded-md text-xxs font-black uppercase tracking-wider bg-yellow-955 text-yellow-300 border-yellow-900 animate-pulse';
                }

                const en = res.energy;
                document.getElementById('energyBreakdown').innerHTML = `
                    &bull; Estimated use: <span class="text-white font-bold">${en.estimated} Wh</span>
                      <span class="text-gray-500">(${en.low}–${en.high} Wh)</span><br>
                    &bull; Baseline flat + climb: <span class="text-white font-bold">${en.base} Wh</span>
                      <span class="text-gray-500">(${en.flat} + ${en.climb})</span><br>
                    &bull; Corrections: surface ×${res.surface.factor.toFixed(2)}, steepness ×${res.steepnessFactor.toFixed(2)}<br>
                    &bull; Usable battery: <span class="text-white font-bold">${res.usableWh} Wh</span>
                      <span class="text-gray-500">(${selectedBattery} − ${res.reserve.percent}% reserve)</span><br>
                    &bull; Safety throttling: <span class="text-white font-bold">${(res.scalingFactor * 100).toFixed(0)}%</span><br>
                    &bull; Confidence: <span class="text-white font-bold">${res.confidence}</span>
                `;

                const ctxPie = document.getElementById('missionPieChart').getContext('2d');
                if (missionPieChartInstance) missionPieChartInstance.destroy();

                missionPieChartInstance = new Chart(ctxPie, {
                    type: 'pie',
                    data: {
                        labels: ['ECO', 'AUTO', 'TRAIL', 'TURBO'],
                        datasets: [{
                            data: [res.distribution.eco, res.distribution.auto, res.distribution.trail, res.distribution.turbo],
                            backgroundColor: ['#10B981', '#3B82F6', '#F59E0B', '#EF4444'],
                            borderWidth: 1,
                            borderColor: '#111827'
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
                    { name: 'MISSION ECO', color: 'green', data: res.eco },
                    { name: 'MISSION AUTO', color: 'blue', data: res.auto },
                    { name: 'MISSION TRAIL', color: 'yellow', data: res.trail },
                    { name: 'MISSION TURBO', color: 'red', data: res.turbo }
                ];

                mModes.forEach(m => {
                    mGrid.innerHTML += `
                        <div class="bg-gray-800 p-4 rounded-xl border border-gray-700 text-xs shadow-md">
                            <div class="flex justify-between items-center mb-2">
                                <span class="font-black text-sm text-white tracking-wide">${m.name}</span>
                                <span class="text-xs font-bold uppercase tracking-wider bg-gray-950 px-2 py-0.5 rounded-md text-${m.color}-400 border border-gray-800">${m.data.wkg} W/kg</span>
                            </div>
                            <div class="space-y-1.5">
                                <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Assist Bound:</span> <span>${m.data.level}</span></p>
                                <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Power Limit:</span> <span>${m.data.watts}</span></p>
                                <p class="text-gray-300 flex justify-between"><span class="text-gray-400 font-bold">Max Torque:</span> <span>${m.data.torque}</span></p>
                            </div>
                        </div>
                    `;
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

        window.addEventListener('DOMContentLoaded', updateSetup);

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
        }
