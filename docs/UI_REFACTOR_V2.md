# Avinox Calc — Piano di refactoring UI/UX (v2.1)

Stato: **pianificazione, nessuna implementazione avviata**
Data: 2026-09-24
Branch: `refactor/ui-ux`
Ambito: `public/index.html`, `public/styles.css`, `public/app.js` (solo markup/CSS/organizzazione JS). Backend `src/server.ts` **non toccato**.

---

## 1. Diagnosi (perché sembra un'accozzaglia)

Dopo 17 PR di funzioni aggiunte a strati, l'interfaccia soffre di cinque problemi strutturali:

1. **Il Tuner è sovraccarico**: nella stessa pagina convivono il form del rider, i preset, gli slider avanzati, il CTA, il riepilogo, 4 card modalità, 3 grafici di confronto E la card di calibrazione con 4 grafici del giro — tutto in un'unica colonna workspace senza gerarchia visiva.
2. **Il flusso di calibrazione non ha una casa**: "carica giro → vedi analisi → calibra → usa medie" è sepolto in un `<details>` dentro il Tuner. È una funzione di secondo livello nascosta come se fosse un dettaglio.
3. **16 pannelli `hidden`** gestiti a mano con classi toggle: la pagina è un mazzo di scatole che si aprono e chiudono senza una gerarchia di navigazione percepita.
4. **Il Route Simulator mescola input e output**: la sidebar ha il form, il workspace ha 6 sezioni condizionali che appaiono/scompaiono — l'utente non capisce lo stato ("ho già analizzato? cosa manca?").
5. **Nessuna gerarchia informativa**: riepilogo, grafici, calibrazione, avvisi hanno tutti lo stesso peso visivo — card su card impilate.

## 2. Principi del redesign

- **Un tab = un compito**: Tuner (configura), Rides (analizza i giri), Route (pianifica), Knowledge (impara). La calibrazione esce dal Tuner e diventa parte del tab Rides.
- **Stato sempre visibile**: l'utente deve sempre sapere cosa ha caricato/calibrato (barra di stato globale, non badge sepolti).
- **Progressive disclosure con gerarchia**: i dettagli (slider avanzati, geometry picker) restano collassabili ma dentro contenitori che dichiarano il loro scopo.
- **Mobile-first**: colonna singola, sezioni ordinate per flusso d'uso, non per storia del codice.

## 3. Nuova architettura

### 3.1 Tab Rides (nuovo — il cambiamento principale)

Nuovo tab **"Rides"** che raccoglie tutto il ciclo del giro reale:

```
┌────────────────────────────────────────────────────────────┐
│ RIDES                                                       │
│ ┌──────────────┐ ┌───────────────────────────────────────┐ │
│ │ LIBRARY      │ │ RIDE INSIGHTS                         │ │
│ │ (elenco      │ │  [4 grafici timeline + energia]       │ │
│ │  giri        │ │  [tabella per livello]                │ │
│ │  caricati)   │ │  [mappa — fase successiva]           │ │
│ │ + Load files │ │                                       │ │
│ ├──────────────┤ └───────────────────────────────────────┘ │
│ │ CALIBRATION  │                                           │
│ │ factor ×N    │                                           │
│ │ [reset]      │                                           │
│ └──────────────┘                                           │
└────────────────────────────────────────────────────────────┘
```

- Sidebar: caricamento file (multi), elenco dei giri caricati nella sessione, stato calibrazione con reset
- Workspace: i 4 grafici Ride Insights, la tabella per livello, il bottone "Use ride averages" (che ora punta al Tuner con un link, non duplica i campi)
- Il Tuner torna a essere **solo configurazione**: rider variables, riding style, slider, CTA — con un piccolo banner "Calibrated ×N — see Rides" quando attivo

### 3.2 Tuner ripulito

- Ordine: Rider Variables → Riding Style → Advanced (collassabile) → CTA
- Il grafico "Battery Duration — Proposed vs DJI Stock" resta nel Tuner (è output del calcolo)
- La card di calibrazione si sposta in Rides; nel Tuner resta solo il badge di stato

### 3.3 Route Simulator con stato esplicito

- Stepper visivo: 1. Source → 2. Parameters → 3. Results (evidenzia dove sei)
- Le sezioni risultato (verdict, breakdown, safety, analysis, modes, elevation) raggruppate in un'unica colonna con intestazioni numerate e stato vuoto esplicito ("Run the analysis to see…")

### 3.4 Dettagli

- Header: **Tuner / Simulator / Rides** + pulsante "?" (About) che apre un dialog con la Knowledge Base completa (come l'app ARE); niente tab Knowledge
- Footer e shell invariati
- Tutti gli ID DOM letti dal JS restano (contratto §4 del piano v1) — il JS si riorganizza, non si riscrive

## 4. Fasi di lavoro

| Fase | Contenuto | Sforzo |
|---|---|---|
| **R1** | Tab Rides: spostare calibrazione + ride insights dal Tuner al nuovo tab; sidebar con libreria di sessione e stato | 2-3 h |
| **R2** | Tuner ripulito: badge calibrazione, rimozione card calibrazione, CTA invariati | 1 h |
| **R3** | Route Simulator: stepper + raggruppamento risultati | 1-2 h |
| **R4** | Knowledge Base come dialog "?" nell'header (come ARE); tab corti Tuner/Simulator/Rides | 1-2 h |
| **R5** | Pulizia CSS: componenti duplicati, classi orfane, riordino in sezioni | 1-2 h |
| **R6** | Verifica manuale completa (3 tab × 2 temi × 2 viewport) + fix | 1-2 h |

Totale stimato: 6-10 h, distribuibili in più sessioni.

## 5. Contratto di invarianza

- Tutti gli ID DOM esistenti restano (il JS continua a funzionare)
- Nessuna modifica a calcoli, API, modello
- La PWA (manifest/SW) non cambia
- Feature non toccate: Route Simulator completo, Knowledge Base, footer, dark mode

## 6. Fuori ambito (futuro)

- Mappa del giro (richiede libreria mappe)
- Libreria giri persistente (IndexedDB — ora la libreria è di sessione)
- Ratio personali per i suggerimenti (feature, non UI)
