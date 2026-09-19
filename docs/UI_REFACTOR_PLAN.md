# Avinox Calc — Piano di refactoring UI (solo estetico)

Stato: **pianificazione approvata, nessuna implementazione avviata**
Data: 2026-09-19
Ambito: `public/index.html` (CSS + markup + stringhe template nel JS). Backend `src/server.ts` e `public/route-file.js` **non vengono toccati**.

---

## 1. Decisioni prese

| Tema | Decisione |
|---|---|
| Palette | **Tema chiaro** "carta tecnica", ispirato al tema attivo di Trailink (`#komoot-theme`) |
| Font | **Solo font di sistema**, nessun download di webfont (uso mobile, offline-friendly) |
| Ambito | **Puramente estetico**: ogni funzionalità, endpoint, ID DOM, funzione JS e comportamento resta identico |
| Brand | Verde lime del logo `#5AF822` usato come colore d'identità (non come testo); antracite del logo `#283038` come colore dei titoli |
| Layout | App-shell: sidebar input a sinistra + workspace risultati a destra; su mobile colonna singola |
| Motor/Battery | Restano nel form del Tuner (dove il JS li legge). Nel Route Simulator si aggiunge un chip **non interattivo** "Using M2S · 800 Wh — set in Engine Tuner" per rendere visibile la dipendenza già esistente |

Le proposte che avrebbero alterato il comportamento (toast al posto di `alert()`, stato "selezionato" dei preset, `<details>` al posto del toggle, hash routing) sono spostate in **§9 Opzionali** e **non fanno parte** di questo refactoring.

---

## 2. Cosa è stato verificato

### 2.1 Progetto
- Frontend = un solo file `public/index.html` (1576 righe): ~245 righe CSS inline, ~500 righe markup, ~800 righe JS. Tailwind via CDN (`cdn.tailwindcss.com`), Chart.js, Axios.
- Molto markup è generato nel JS via `innerHTML` con classi Tailwind (card risultati, boost, mission, route modes, file summary, geometry picker, grade bars).
- Backend Express: `POST /api/calculate`, `POST /api/calculate-mission`, `POST /api/route-modes`. Statico da `public/`.
- Il Route Simulator legge `#bike` e `#batteryWh` dal form del Tuner (dipendenza tra tab non visibile all'utente).

### 2.2 Brand (pixel-sampling degli asset in `public/assets/`)
| Ruolo | Colore |
|---|---|
| Verde lime "A" e "CALC" | `#5AF822` (range #50F820–#60F828) |
| Antracite "AVINOX" e tratto | `#283038` / `#303840` |
| Sfondo favicon | `#212529` |

### 2.3 Riferimento Trailink (`http://127.0.0.1:8734/`, analisi del CSS servito)
- Tema effettivo chiaro: `--bg #FAF9F4`, `--surface #F5F3EC`, `--surface-2 #EDE9DE`, `--border #E0DBCE`, `--text #1C1A18`, `--muted #736554`, accent unico `#4F6814`, warn `#EE6B17`, danger `#E4462D`, ombre calde `rgba(58,48,34,…)`.
- Shell `grid 390px / 1fr` a tutta altezza; sidebar: brand → contenuto scrollabile → footer sticky con CTA; workspace con barre flottanti (summary bar, toolbar).
- Tipografia compatta: label 10.5px uppercase `letter-spacing .06em` muted; body 12–13px; valori 13–14px peso 750. Nessuna emoji, nessun `font-black`.
- Componenti: `.field`, `.btn`/`.btn.primary`, card bianche `border 1px + shadow 2px 9px`, `count-badge` pill, `warning-item` ambra, `empty-msg`, `export-stat` (label 9px + valore).
- Radius 10–13px, focus ring `0 0 0 3px rgba(accent,.1)`, transizioni `.15s`.
- Responsive: ≤850px sidebar 330px; ≤640px colonna singola con `body{overflow:auto}`.

### 2.4 Stato attuale da sostituire
Sfondo quasi nero con gradienti radiali e blur, verde neon `#39ff14` con glow, `!important` a pioggia per vincere Tailwind, emoji in tab/titoli, tutto `uppercase tracking-widest`, 7 colori di titolo diversi nella Knowledge Base, `animate-pulse` sui badge.

---

## 3. Design tokens

```css
:root {
  /* superfici */
  --bg: #FAF9F4;            /* pagina */
  --surface: #FFFFFF;       /* card */
  --surface-2: #F5F3EC;     /* card nidificate, thead, input bg alternativo */
  --surface-3: #EDE9DE;     /* track barre, hover */
  --border: #E0DBCE;
  --border-strong: #CFC7B9;

  /* testo */
  --ink: #283038;           /* titoli, header — antracite del logo */
  --text: #1C1A18;
  --muted: #736554;
  --faint: #9C9284;

  /* brand */
  --brand: #5AF822;         /* SOLO identità: linea header, tab attivo, ring focus, fill chart */
  --accent: #2F7D0E;        /* stesso hue, contrasto AA su --bg: bottoni, link, stati attivi */
  --accent-hover: #3B9A14;
  --accent-soft: #EAF7E2;   /* sfondo selezionato / badge */

  /* semantica */
  --ok: #2F7D0E;
  --warn: #EE6B17;  --warn-bg: #FCE1D1;  --warn-border: #F4B58D;  --warn-text: #8A3E0E;
  --danger: #E4462D; --danger-bg: #FBE2DC; --danger-border: #F2A99B; --danger-text: #8E2A1A;

  /* modalità (desaturate, usate come stripe/dot, non come colore titolo) */
  --mode-eco: #3E8E41;
  --mode-auto: #2B6CB0;
  --mode-trail: #C77700;
  --mode-turbo: #C0392B;
  --mode-custom: #6B4FA3;   /* BOOST e custom route modes */

  /* forma */
  --r-sm: 7px;  --r: 10px;  --r-lg: 13px;
  --shadow: 0 2px 9px rgba(58,48,34,.06);
  --shadow-lg: 0 18px 50px rgba(58,48,34,.18);
  --focus: 0 0 0 3px rgba(47,125,14,.15);

  /* tipografia */
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --fs-label: 10.5px;  --fs-body: 12.5px;  --fs-title: 12px;  --fs-value: 14px;  --fs-h2: 15px;  --fs-h1: 18px;
}
```

Regole d'uso:
- `--brand` mai come colore di testo o sfondo di bottone su fondo chiaro (contrasto ≈1.4:1).
- `--accent` su `--bg`/`--surface`: contrasto ≥ 4.5:1 (AA). `--muted` su `--surface`: ≥ 4.5:1.
- Valori numerici sempre `font-variant-numeric: tabular-nums`.
- Su mobile gli input hanno `font-size: 16px` per evitare lo zoom automatico di iOS.
- Nessuna emoji nei controlli e nei titoli; nessun `text-transform: uppercase` fuori da `.section-title` e `.field > label`.

---

## 4. Vincoli di invarianza funzionale (contratto)

Tutto ciò che segue **deve restare identico** dopo il refactoring. È la checklist di verifica finale.

### 4.1 ID DOM letti/scritti dal JS (non rinominare, non rimuovere)
- Tuner form: `calcForm`, `bike`, `batteryWh`, `boostDuration`, `riderWeight`, `bikeWeight`, `cadence`, `riderPower`
- Sliders: `ecoWkg`/`ecoWkgSlider`, `autoWkg`/`autoWkgSlider`, `trailWkg`/`trailWkgSlider`, `turboWkg`/`turboWkgSlider`, `advancedSlidersPanel`, `advancedToggleIcon`, `advancedToggleText`
- Tuner output: `sysWeight`, `calcWarnings`, `resultsGrid`, `boostCard`, `rangeChartTitle`, `rangeChart`, `runtimeChart`
- Tab: `tabCalc`, `tabMission`, `tabGuide`, `tabCalcBtn`, `tabMissionBtn`, `tabGuideBtn`
- Route form: `missionForm`, `srcManualBtn`, `srcFileBtn`, `targetKm`, `targetH_m`, `surface`, `reservePercent`, `fileSource`, `dropZone`, `routeFileInput`, `fileStatus`, `geometryPicker`, `fileSummary`
- Route output: `energyVerdict`, `energyBreakdown`, `missionPieChart`, `missionGrid`, `routeAnalysis`, `gradeBars`, `climbList`, `routeModes`, `routeModesGrid`, `routeModeNotes`, `elevationPanel`, `elevationChart`, `elevationNote`
- Generati a runtime: `geomCounter`, `geomAll`, `geomNone`, `input[data-geom]`, `button[data-copy-mode]`
- Anchor Knowledge Base: `kb-quick`, `kb-sliders`, `kb-parameters`, `kb-modes`, `kb-grid`, `kb-formula`

### 4.2 Attributi/handler inline da preservare
`onclick="switchTab('calc'|'mission'|'guide')"`, `onclick="loadPreset(…)"` con i 3 set di valori, `onclick="toggleAdvancedSliders()"`, `onclick="updateSetup()"`, `onclick="setRouteSource('manual'|'file')"`, `type="submit"` in `missionForm`, `accept` dell'input file, i `value/min/max/step` di tutti gli input, gli `optgroup/option` delle select.

### 4.3 Classi che il JS aggiunge/rimuove (vanno definite nel nuovo CSS perché oggi arrivano da Tailwind)
- `.hidden { display:none }` e `.block { display:block }` — usate da `switchTab`, `toggleAdvancedSliders`, `setRouteSource`, pannelli route.
- `.is-active` — tab e source toggle.
- `.border-green-500` — aggiunta a `#dropZone` durante il drag → definire `#dropZone.border-green-500 { border-color: var(--accent); background: var(--accent-soft) }`.
- `energyVerdict.className = '… bg-green-955 text-green-300 border-green-900'` e la variante yellow con `animate-pulse` → il JS viene modificato solo per assegnare le nuove classi (`badge badge-ok` / `badge badge-warn`), mantenendo la logica `res.feasible`.
- `fileStatus.className = 'text-xxs ' + colore` → mappa `{ error, ok, info }` sulle nuove classi `.status-error/.status-ok/.status-info`.
- `grid.className` in `renderRouteModes` → conserva la logica del numero di colonne (1/2/3/4) con nuove classi `.cols-1 … .cols-4`.

### 4.4 Comportamenti
- `updateSetup()` al `DOMContentLoaded` e a ogni input su slider/number; preset che scrivono su number+slider e ricalcolano.
- Titolo chart range che cambia con la batteria selezionata.
- Route: modalità Manual/File, parsing lato client, selezione segmenti con "All / First only", impossibilità di selezione vuota, riempimento di `targetKm`/`targetH_m` dal file (elevazione svuotata se assente), `alert()` se si analizza in modalità file senza file, `alert('Mission analysis failed.')` su errore, chiamata a `/api/route-modes` dopo `/api/calculate-mission`, bottoni Copy con feedback "Copied" 1.2 s.
- Chart.js: stessi tipi (bar, bar, pie, line), stesse opzioni funzionali (`parsing:false`, `bounds:'data'`, tooltip callbacks, `maxTicksLimit`). Cambiano solo colori, font e raggio barre.
- Tutti i testi visibili (label, hint, descrizioni, Knowledge Base) restano identici, salvo la **rimozione delle emoji** e dei prefissi numerici "1./2./3." nei tab.

---

## 5. Architettura CSS

- `public/styles.css` con i token, un reset minimo e una **libreria di componenti** a nomi propri (niente utility Tailwind).
- Tailwind CDN rimosso **solo nell'ultima fase**, quando `grep` di classi Tailwind in HTML e JS restituisce zero risultati.
- Nessun `!important`.

Componenti da definire:

| Classe | Uso |
|---|---|
| `.app`, `.app-header`, `.sidebar`, `.sidebar-body`, `.sidebar-footer`, `.workspace`, `.workspace-body` | shell |
| `.brand`, `.brand-logo`, `.brand-mark` | logo (full ≥768px, mark <768px) |
| `.tabs`, `.tab`, `.tab.is-active` | navigazione (sottolineatura 2px `--brand`, testo `--ink`) |
| `.section-title` | 10.5px uppercase muted |
| `.field`, `.field > label`, `.field-row`, `.hint` | form |
| `.input`, `.select`, `.range`, `.check` | controlli |
| `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-sm` | bottoni |
| `.segmented`, `.segmented > button`, `.is-active` | Manual / Route file |
| `.card`, `.card-header`, `.card-title`, `.card-subtitle`, `.card-body`, `.card-footer` | contenitori |
| `.preset` | i 3 bottoni di riding style (card cliccabile, dot `--mode-*`) |
| `.summary-bar`, `.summary-item`, `.summary-label`, `.summary-value` | riga KPI in alto nel workspace |
| `.mode-card[data-mode]` | card ECO/AUTO/TRAIL/TURBO/custom con stripe sinistra 3px |
| `.kv`, `.kv-row`, `.kv-label`, `.kv-value`, `.kv-hint` | righe chiave-valore |
| `.badge`, `.badge-soft`, `.badge-ok`, `.badge-warn`, `.badge-danger`, `.badge-mode` | etichette |
| `.stat`, `.stat-label`, `.stat-value` | blocchi Boost (torque/power/duration) |
| `.callout`, `.callout-info`, `.callout-warn`, `.callout-danger` | avvisi |
| `.status-info`, `.status-ok`, `.status-error` | `fileStatus` |
| `.dropzone` | import GPX/KML |
| `.track-item` | righe del geometry picker |
| `.mini-btn` | All / First only |
| `.bar`, `.bar-fill` | grade bars |
| `.chart-card`, `.chart-box` | wrapper canvas con altezza fissa |
| `.legend`, `.legend-dot` | legenda pie |
| `.kb-nav`, `.kb-section`, `.kb-grid`, `.kb-table`, `.kb-formula` | Knowledge Base |
| `.cols-1 … .cols-4` | griglie risultati |
| `.hidden`, `.block` | compat con il JS esistente |

---

## 6. Layout

### 6.1 Desktop (≥1024px)
```
┌──────────────────────────────────────────────────────────────┐
│ header 52px: [logo] [Engine Tuner][Route Simulator][Knowledge] │ ← border-bottom 1px + linea 3px --brand
├───────────────┬──────────────────────────────────────────────┤
│ sidebar 360px │ workspace (scroll)                            │
│ (scroll)      │  summary-bar                                  │
│  section      │  card risultati / chart                       │
│  field…       │                                               │
│ footer sticky │                                               │
│ [CTA primary] │                                               │
└───────────────┴──────────────────────────────────────────────┘
```
`#app { display:grid; grid-template-columns: 360px minmax(0,1fr); min-height:100vh }`. La pagina scorre normalmente (a differenza di Trailink non serve `overflow:hidden`: non c'è una mappa); sidebar `position: sticky; top: 52px; max-height: calc(100vh - 52px); overflow:auto`.

### 6.2 Tablet (768–1023px)
Grid `320px / 1fr`; tab nell'header con scroll orizzontale; griglie risultati a 2 colonne.

### 6.3 Mobile (<768px)
- Colonna singola: header (logo-mark + tab scrollabili) → sidebar (form) → footer CTA **sticky bottom** → workspace sotto.
- Griglie risultati a 1 colonna; summary-bar a scroll orizzontale; chart `height: 220px`.
- Touch target ≥ 40px; input `font-size:16px`; `.kb-nav` sticky sotto l'header.

### 6.4 Knowledge Base
Nessun input → la sidebar contiene l'indice delle sezioni (`.kb-nav` con gli stessi anchor `#kb-*`); il workspace mostra il contenuto a `max-width: 76ch`. Su mobile l'indice diventa una riga sticky scrollabile.

---

## 7. Piano step-by-step

### Fase A — Preparazione (nessun cambiamento visivo)
- **A1.** `git checkout -b ui/refactor-light`; screenshot baseline dei 3 tab a 1440px, 1024px, 390px.
- **A2.** Spostare il CSS inline in `public/styles.css` e il JS inline in `public/app.js` (spostamento 1:1, nessuna modifica; `app.js` caricato dopo `route-file.js` e prima di `</body>` come oggi). Verificare comportamento identico.
- **A3.** Collegare `styles.css` **dopo** il CDN Tailwind per vincere in cascata senza `!important`.
- **A4.** Congelare il contratto §4: script `grep` che elenca gli `id=` e i `getElementById(` per confronto prima/dopo.

### Fase B — Fondamenta
- **B1.** Sostituire i 15 token attuali con quelli di §3; `html { color-scheme: light }`; `<meta name="theme-color" content="#FAF9F4">`.
- **B2.** Reset minimo: `*{box-sizing}`, `button,input,select{font:inherit}`, `body{font-family:var(--font);font-size:var(--fs-body);background:var(--bg);color:var(--text)}`, scrollbar sottile, `@media (prefers-reduced-motion) { *{transition:none} }`.
- **B3.** Scrivere la libreria di componenti §5 (solo CSS, ancora non applicata al markup).
- **B4.** Definire `.hidden`, `.block`, `#dropZone.border-green-500`, `.cols-1…4` (compat JS).

### Fase C — Shell e navigazione
- **C1.** Nuovo scheletro `#app > header.app-header + aside.sidebar + main.workspace`. I tre contenitori `#tabCalc/#tabMission/#tabGuide` restano e conservano `switchTab` così com'è; ciascuno contiene la propria coppia sidebar/workspace tramite `display: contents` sul contenitore del tab, così la grid è unica e il JS non cambia.
- **C2.** Header: `logo-full.png` h 32px (≥768px) / `logo-mark.png` h 28px (<768px); tab "Engine Tuner / Route Simulator / Knowledge Base" (testi senza emoji e numeri); `role=tablist/tab` e `aria-selected` già gestiti dal JS.
- **C3.** Sidebar footer sticky con il bottone primario (`Generate Custom Setup` / `Analyze Strategy`) — stessi elementi e handler di oggi, solo riposizionati nel footer della sidebar.
- **C4.** Knowledge Base: `.knowledge-nav` → `.kb-nav` nella sidebar (stessi anchor); contenuto nel workspace.

### Fase D — Tab Engine Tuner
- **D1.** Sidebar: `.section-title "Rider variables"` → Motor, Battery (+ hint FP700), Boost duration, Rider/Bike weight (`.field-row`), Cadence/Power (`.field-row`). Stessi id/valori.
- **D2.** `.section-title "Riding style"` → i 3 preset come `.preset` (dot `--mode-eco/auto/turbo`, titolo, descrizione). Testi senza emoji.
- **D3.** Advanced W/kg: stesso bottone toggle e `#advancedSlidersPanel`; restyle come `.btn-ghost .btn-sm` + pannello `.card` `--surface-2`; l'icona 🛠️/✖️ scritta dal JS viene sostituita da un chevron testuale (`▸`/`▾`) — unico cambio nel JS di `toggleAdvancedSliders`, solo testuale.
- **D4.** Workspace: `.summary-bar` con `#sysWeight` come primo `.summary-item` (l'`innerText` scritto dal JS resta "Total Weight: NN kg"); accanto, `.summary-item` statici per Battery e Motor letti… **no**: solo elementi statici testuali non collegati al JS sarebbero fuorvianti → la summary bar contiene solo `#sysWeight` e il titolo/sottotitolo "Avinox App Custom Setup — Copy these exact values…".
- **D5.** `resultsGrid`: template in `updateSetup()` riscritto con `.mode-card[data-mode]` + `.kv-row`; badge W/kg `badge-danger` quando `isHighDrain` (senza pulse); `typeBadge` → `.badge-soft`; `warnBlock` → `.callout-danger`; hint "(computed …)" → `.kv-hint`. Griglia `.cols-2` (<1280) / `.cols-4` (≥1280).
- **D6.** `boostCard` → `.mode-card[data-mode=custom]` con 3 `.stat`.
- **D7.** Chart: una `.chart-card` con 2 `.chart-box`; funzione `chartTheme()` che legge i token da `getComputedStyle(document.documentElement)` e restituisce colori grid/tick/dataset — usata da `initCharts`, pie e elevazione. Bar `borderRadius: 4`.
- **D8.** `calcWarnings` → `.callout-warn`.

### Fase E — Tab Route Simulator
- **E1.** Sidebar: chip non interattivo "Using {motor} · {Wh} — set in Engine Tuner" (testo statico aggiornato da un listener `change` su `#bike`/`#batteryWh`: solo lettura, nessun effetto sul calcolo); `.segmented` Manual / Route file (stessi `#srcManualBtn/#srcFileBtn`, classe `is-active`); `.field` Distance, Elevation gain, Surface, Reserve %; `.dropzone` stile Trailink.
- **E2.** `fileStatus` → `.status-*`; `geometryPicker` → `.track-item` + `.mini-btn`; `fileSummary` → `.card` compatta con `.kv` + `.callout-warn`.
- **E3.** Workspace: `.summary-bar` con titolo "Energy Feasibility Status" e `#energyVerdict` come `.badge` (`badge-ok`/`badge-warn`, testi FEASIBLE / CRITICAL MARATHON invariati); card "Energy breakdown" con lo stesso `innerHTML` riformattato in `.kv` (stessi valori e ordine) + pie (tipo invariato) con `.legend`.
- **E4.** `missionGrid` → `.mode-card` con 3 `.kv-row`; `routeModesGrid` → `.mode-card[data-mode=custom]` + `.btn-sm` Copy; `gradeBars` → `.bar/.bar-fill` con colori `--mode-*` mappati sulle bande esistenti; `elevationPanel` → `.chart-card`, linea `--accent`, fill `rgba(47,125,14,.12)`.
- **E5.** `alert()` restano (vedi §9).

### Fase F — Tab Knowledge Base
- **F1.** Sezioni come `.kb-section.card` con `h2` 15px `--ink` (un solo colore, senza emoji), sottotitolo muted.
- **F2.** Griglie interne `.kb-grid` a 2/4 colonne con card `--surface-2`; numeri "01.–04." in `--accent`.
- **F3.** Tabella `.kb-table`: `thead` `--surface-2`, zebra, nome modo con dot `--mode-*`.
- **F4.** Formula `.kb-formula`: blocco `--surface-2`, `--font-mono` 13px, colore `--ink`.

### Fase G — Pulizia
- **G1.** Rimuovere `<script src="https://cdn.tailwindcss.com">`.
- **G2.** `grep -nE "bg-gray-|text-gray-|text-xxs|rounded-|shadow-(md|xl|lg)|space-y-|tracking-|font-black|border-gray-|text-(green|blue|yellow|red|purple|teal|orange)-" public/index.html public/app.js` → 0 risultati.
- **G3.** `grep -c "!important" public/styles.css` → 0.
- **G4.** Introdurre nel JS gli helper `kvRow(label, value, hint)`, `modeCard({mode, title, badges, rows, footer})`, `callout(kind, html)` per eliminare la duplicazione dei template. Output HTML equivalente, dati identici.
- **G5.** `<title>` → "Avinox Calc"; `lang="en"` mantenuto.

### Fase H — Responsive e accessibilità
- **H1.** Breakpoint §6; test reali a 390/414/768/1024/1440px.
- **H2.** Focus visibile (`--focus`) su tutti i controlli; `aria-controls` sui tab; label associate (già presenti); `aria-live="polite"` su `#sysWeight`, `#energyVerdict`, `#fileStatus`.
- **H3.** Verifica contrasto AA: `--accent`/`--bg`, `--muted`/`--surface`, `--warn-text`/`--warn-bg`, `--danger-text`/`--danger-bg`, testi delle mode-card.

### Fase I — Verifica
- **I1.** Confronto con gli screenshot baseline (3 tab × 3 viewport).
- **I2.** Checklist §4.4 eseguita manualmente: preset → card; slider ↔ number; batteria → titolo chart; Route manual → verdict + 4 card + route modes + Copy; Route file con GPX multi-segmento → picker, elevation, grade bars, warning; file senza elevazione → `targetH_m` vuoto; analisi senza file → `alert`.
- **I3.** Diff degli ID: lo script A4 deve dare lo stesso insieme prima e dopo.
- **I4.** `npm run build` senza errori; verificare che il Dockerfile copi `public/` con i nuovi `styles.css`/`app.js`.
- **I5.** Lighthouse mobile: accessibilità ≥ 95, nessun problema di contrasto.

---

## 8. Stima e rischi

| Fase | Effort | Rischio |
|---|---|---|
| A–B | 2–3 h | basso |
| C | 3–4 h | medio — shell con `display: contents` da testare su Safari iOS |
| D–E | 5–6 h | medio — template dentro il JS |
| F | 1–2 h | basso |
| G–H–I | 3 h | basso |
| **Totale** | **14–18 h** | |

Rischi e mitigazioni:
1. Le card via `innerHTML` sono il 60% del lavoro → scrivere prima gli helper (G4) e usarli da D5 in avanti.
2. Rimuovere Tailwind troppo presto rompe il layout → solo in G1, dopo il grep a zero.
3. Uso indisciplinato del lime `#5AF822` riporta al look "neon" → consentito solo in: linea header, tab attivo, ring focus, fill chart.
4. `display: contents` e `position: sticky` su iOS Safari → verificare in H1; fallback: duplicare la grid dentro ogni tab.
5. Il nuovo chip "Using … set in Engine Tuner" introduce un listener: è sola lettura, ma va coperto in I2.

---

## 9. Opzionali (fuori ambito, da approvare separatamente)

Questi cambierebbero il comportamento e **non** fanno parte del refactoring estetico:
- `alert()` → toast non bloccante.
- Stato "selezionato" persistente sul preset di riding style.
- `<details>/<summary>` nativo al posto di `toggleAdvancedSliders()`.
- Tab attivo salvato in `location.hash`.
- Doughnut al posto del pie.
- Variante scura con `prefers-color-scheme: dark` (`--bg #212529`, `--surface #283038`, lime usabile come accent).
