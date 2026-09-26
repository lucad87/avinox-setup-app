# Avinox Setup Calculator

Strumento per configurare l'assistenza delle e-bike **DJI Avinox M1/M2/M2S** e per capire
quanto costa un percorso: stima i parametri dei modi ECO, AUTO, TRAIL e TURBO dal rapporto
potenza/peso (ciclista + bici) e dalla cadenza, e analizza un percorso pianificato (`.gpx` /
`.kml`) o una registrazione reale (`.proto`) per dire se la batteria basta, che pendenze e
salite ha, e come impostare le modalità su misura.

**Live:** https://avinox-calculator.lucad.cloud/

## Le due schede

**Tuner — come si configura la bici.** Bici e pacco batteria, peso ciclista e bici, cadenza e
potenza del rider; un profilo di guida pronto (o gli slider W/kg avanzati). Per ogni modo escono
**tre numeri da inserire nell'app DJI Avinox**: livello di assistenza, potenza massima e coppia
massima. I grafici di autonomia e durata si aggiornano con i valori impostati.

**Route — quanto costa un percorso.** Una sola zona di caricamento accetta:
- una **route pianificata** (`.gpx` / `.kml`): fattibilità energetica, distribuzione delle
  pendenze, salite rilevate, profilo altimetrico, i modi che quel terreno richiede e il
  **tracciato su mappa colorato per pendenza** (6 bande: Descent, Flat, Rolling, Climb, Steep,
  Extreme);
- una **registrazione** (`.proto` dell'app DJI): analisi con i **numeri propri del giro**
  (distanza dall'odometro della bici, consumo misurato su quel file) più mappa, 9 gruppi di
  grafici dei sensori e calibrazione;
- oppure valori inseriti a mano.

I dettagli dell'analisi (pendenze, salite, mappa, profilo altimetrico, modi proposti) stanno in
blocchi richiudibili con la cifra chiave nell'intestazione; verdetto e consumo restano sempre
visibili. L'analisi legge i valori del Tuner e li segue: se cambi peso, cadenza o potenza nel
Tuner, viene ricalcolata da sola.

### Affidabilità dei numeri

- **Consumo reale:** dai giri caricati l'app misura il Wh/km del motore e ne ricava un fattore
  personale applicato a ogni stima di autonomia, durata ed energia. Per una registrazione il
  numero principale è l'energia **effettivamente usata** in quel giro.
- **Guardia di plausibilità:** una misura fuori scala (fattore molto lontano da 1, o consumo
  sotto 2,5 Wh/km) **non viene applicata**: le cifre restano quelle del modello generico e la
  scheda lo dice, invece di scalare in silenzio.
- **Tratti tratteggiati sulla mappa:** se la registrazione perde il fix GPS, i campi di posizione
  non esistono nel file. L'app disegna quei tratti **tratteggiati** (posizione ignota) invece di
  unirli con una linea retta mai percorsa, e dice quanti sono e quanto lunghi sono. Distanza e
  consumo non ne sono toccati: l'odometro continua a contare.

### Dati e privacy

Tutto viene elaborato **sul dispositivo**: i file non vengono mai caricati da nessuna parte.
Percorsi e registrazioni caricati restano sul dispositivo (IndexedDB) e vengono ripristinati alla
visita successiva. Nell'header: **Export** (un file JSON con i file caricati e la calibrazione),
**Import** (per rimetterli, anche su un altro browser) e **Clear all data** (cancella tutto:
file, calibrazione e impostazioni salvate).

La guida integra è nel **?** in alto a destra (Knowledge Base).

## Stack

- **Backend:** TypeScript + Express
- **Frontend:** HTML/CSS/JS statico (nessun framework, nessun Tailwind), Chart.js, MapLibre GL,
  Axios — tutti da CDN
- **Build:** TypeScript compiler
- **Deploy:** Docker (build multi-stage su Alpine), servito dietro Cloudflare

## Script

| Comando | Descrizione |
|---|---|
| `npm start` | Avvia in sviluppo con ts-node |
| `npm run build` | Compila TypeScript in `dist/` |
| `npm run serve` | Avvia la versione compilata |
| `npm test` | Test del modello energetico, delle API e dell'energia dei giri |

## Docker

```bash
docker build -t avinox-setup-app .
docker run -p 3080:3080 avinox-setup-app
```

L'applicazione ascolta sulla porta **3080**.

## Test

La verifica end-to-end della scheda Route (tab, analisi, mappe, cursore, calibrazione, storage,
import/export, Knowledge Base) è uno script Playwright singolo con una checklist di asserzioni.

---

# English Version

## Overview

A tool to configure the assist of **DJI Avinox M1/M2/M2S** e-bikes and to understand what a route
costs: it estimates the ECO, AUTO, TRAIL and TURBO parameters from the system power-to-weight ratio
(rider + bike) and cadence, and analyses a planned route (`.gpx` / `.kml`) or a real recording
(`.proto`) to say whether the battery is enough, what the gradients and climbs are, and which
modes the terrain calls for.

**Live:** https://avinox-calculator.lucad.cloud/

## The two tabs

**Tuner — how the bike is set up.** Bike and battery pack, rider and bike weight, cadence and rider
power; a ready riding style (or the advanced W/kg sliders). Each mode outputs **three numbers to
enter in the official DJI Avinox app**: assist level, max power and max torque. The range and
runtime charts follow what you set.

**Route — what a route costs.** A single drop zone accepts:
- a **planned route** (`.gpx` / `.kml`): energy feasibility, grade distribution, detected climbs,
  elevation profile, the modes the terrain calls for and the **track on a map coloured by
  gradient** (six bands: Descent, Flat, Rolling, Climb, Steep, Extreme);
- a **recording** (`.proto` from the DJI app): analysed with **its own numbers** (distance from the
  bike's odometer, consumption measured on that file) plus its map, nine sensor graph groups and
  the calibration;
- or values typed by hand.

The analysis details (grades, climbs, map, elevation profile, proposed modes) sit in collapsible
blocks whose header carries the key figure; the verdict and the consumption stay visible. The
analysis reads the Tuner's values and follows them: change weight, cadence or rider power there and
it recalculates by itself.

### How trustworthy the numbers are

- **Real consumption:** from the loaded rides the app measures the motor Wh/km and derives a
  personal factor applied to every range, runtime and energy estimate. For a recording the headline
  is the energy that ride **actually used**.
- **Plausibility guard:** a measurement out of scale (a factor far from 1, or a consumption under
  2.5 Wh/km) is **not applied**: the figures stay those of the generic model and the card says so,
  instead of scaling in silence.
- **Dashed stretches on the map:** when a recording loses its GPS fix the position fields are simply
  absent from the file. Those stretches are drawn **dashed** (unknown position) instead of being
  joined by a straight line the bike never rode, and the app reports how many and how long. Distance
  and consumption are unaffected: the odometer keeps counting.

### Data and privacy

Everything is processed **on the device**: the files are never uploaded anywhere. Loaded routes and
recordings stay on the device (IndexedDB) and are restored on the next visit. In the header:
**Export** (one JSON file with the loaded files plus the calibration), **Import** (to restore them,
on another browser too) and **Clear all data** (removes files, calibration and saved settings).

The built-in guide is behind the **?** in the header (Knowledge Base).

## Stack

- **Backend:** TypeScript + Express
- **Frontend:** static HTML/CSS/JS (no framework, no Tailwind), Chart.js, MapLibre GL and Axios from
  CDN
- **Build:** TypeScript compiler
- **Deploy:** Docker (multi-stage build on Alpine), served behind Cloudflare

## Scripts

| Command | Description |
|---|---|
| `npm start` | Run in development mode with ts-node |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run serve` | Run the compiled production version |
| `npm test` | Tests for the energy model, the API and the ride energy |

## Docker

```bash
docker build -t avinox-setup-app .
docker run -p 3080:3080 avinox-setup-app
```

The app listens on port **3080**.

## Tests

The end-to-end verification of the Route tab (tabs, analysis, maps, cursor, calibration, storage,
import/export, Knowledge Base) is a single Playwright script with a checklist of assertions.

## License

Released under the [MIT License](LICENSE) — © 2026 Luca Donnaloia.
If you reuse or fork this project, keep the copyright notice and consider crediting
[Avinox Calc](https://avinox-calculator.lucad.cloud/).
