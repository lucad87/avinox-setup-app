# Avinox Calc — Roadmap

Stato aggiornato: 2026-09-26 · versione corrente: **2.0.0** (in merge il refactor UI v2.1: due tab, Tuner + Route)

Legenda: ✅ fatto · 🚧 in corso · 📋 backlog · ❓ da verificare sul campo

---

## Fase 0 — Fondamenta (completata, v1.x)

- ✅ Tema chiaro "carta tecnica" + dark mode con toggle persistente
- ✅ Estrazione CSS/JS in file esterni, libreria componenti propria (niente Tailwind)
- ✅ Tabella livelli comunitaria (anchor 3/4/8/13) con % di input rider nelle card
- ✅ Stima runtime realistica: `min(amplificazione × rider power, Max Power, tetto coppia alla cadenza)`
- ✅ Grafico confronto durata: modalità proposte vs stock DJI
- ✅ Bande modalità confermate dall'app DJI (ECO 1-7, AUTO 3-11, TRAIL 6-13, TURBO 8-15)
- ✅ Footer crediti + donazioni PayPal, licenza MIT

## Fase 1 — Comfort & installabilità ✅ (rilasciata in 2.0.0)

- ✅ **PWA installabile**: manifest + service worker (network-first, fallback offline)
- ✅ **Persistenza parametri**: peso, bici, batteria, cadenza, rider power e slider W/kg
  salvati in `localStorage` e ripristinati alla visita successiva
- ✅ **Badge privacy in evidenza**: il parsing GPX/proto è dichiarato come elaborazione
  locale, non più sepolto in un hint

## Fase 2 — Calibrazione dai giri reali 🚧

Obiettivo: tarare il modello sui dati reali dell'utente, usando i file di registrazione
dell'app Avinox (`cloud_ride_rec_*.proto`, sincronizzati dal display al telefono
dall'app ufficiale DJI).

Mappa dei campi del formato: reverse-engineering comunitario documentato
(header 251 byte con magic `0xA5A5A5A5`, frame `0x02EB`, campioni protobuf con
speed, assist, cadence, coppie rider/motor/total, potenze rider/motor/total,
gear, GPS, altitudine, pendenza, battito, temperatura, batteria).

### 2A — Parser .proto + analisi del giro ✅ (rilasciata in 2.0.0)

- ✅ Parser client-side (`public/avinox-proto-parser.js`), nessun upload: il file
  resta nel browser
- ✅ Card "Calibrate from a real ride" nel Tuner: riepilogo del giro (durata,
  distanza, batteria inizio/fine, energia motore) e tabella per livello
  (tempo, potenza media rider/motore, energia)
- ✅ **Fattore personale di calibrazione**: rapporto tra energia motore reale del
  giro e quella che il modello (tabella comunitaria) avrebbe previsto → le stime
  di autonomia/runtime vengono moltiplicate per il fattore inverso, con hint
  visibile e reset

### 2B — Loader ADB dal telefono 📋

- 📋 Import diretto dal telefono via WebUSB + ADB (libreria open source
  `@yume-chan/adb`, stessa approccio di Avinox Ride Explorer): l'utente collega
  il telefono con debugging USB e i giri vengono importati senza copia manuale
- 📋 Libreria giri locale (IndexedDB) con confronto tra più giri

### 2C — Lettura diretta dal display ❓

- ❓ Il display Avinox espone i file via USB-C? Da verificare sul campo; se sì,
  valutare il protocollo. Priorità bassa: la via telefono (2A/2B) copre il caso
  d'uso principale

## Fase 3 — Ecosistema 📋

- 📋 Unità metriche/imperiali
- 📋 Link condivisibili del setup
- 📋 Export della configurazione in formati standard
- 📋 Calibrazione comunitaria anonima (richiede backend di raccolta dati e
  valutazione privacy)

## Note di calibrazione

- Tabella livelli: comunitaria, multi-fonte, anchor 3=100% / 4=150% / 8=300% / 13=700%
- Bande modalità: confermate dall'app DJI (screenshot)
- Modalità stock DJI (riferimento): ECO L4 · 50 Nm · 200 W · 64 km — AUTO 7-11 ·
  1300 W · 49 km — TRAIL 9-11 · 45 km — TURBO L13 · 1300 W · 40 km
- Target W/kg default e modello di autonomia: calibrazione propria del progetto
  (dichiarata in KB)

## Prossimo — Hand-off dei modi assistenza da Route al Tuner 📋

Discusso il 26/09, da riprendere. Idea: poter **portare i modi proposti dal tab
Route dentro il Tuner**, invece di ridigitare a mano i valori nell'app DJI.

Dato di fatto che decide il progetto: le due parti espongono **gli stessi sei
campi nello stesso ordine** — Assist Level, Max Power, Max Torque, Max Overrun,
Assist Start, Continued Assist. Non serve quindi una traduzione: serve decidere
*dove atterrano* i valori.

Attenzione al malinteso di fondo: il Tuner è l'assetto **generale** (4 modi base
ECO/AUTO/TRAIL/TURBO, *calcolati* dagli slider W/kg); Route propone 2-3 modi
**custom, specifici per quel percorso** (livello fisso, etichetta e rationale
propri, badge "Fixed"). Non sono gli stessi modi e non esiste un mapping 1:1.
Verificato nel codice: le proposte di Route **non dipendono** dagli slider W/kg
(la submit manda bici, batteria, pesi, cadenza, rider power — non ecoWkg…turboWkg),
quindi copiarle sopra le 4 card base produrrebbe card che non corrispondono più
ai loro slider.

Tre opzioni:
- **(a) blocco separato nel Tuner** — "Route setup — per `<file o giro>`, `<data>`"
  in cima al workspace, con i modi arrivati da Route e il loro Copy per l'app DJI,
  e una ✕ per scartarli. Le 4 card base restano intatte e oneste. *Raccomandata.*
- **(b) solo "Copy all" in Route** — un unico blocco pronto da incollare, tutti i
  modi in ordine, nessun trasferimento di stato. Passo minimo, zero rischio:
  da fare per primo se il trasferimento al Tuner sembra troppo.
- **(c) sovrascrivere le 4 card base / pilotare gli slider** dai valori di Route.
  Sconsigliata: servirebbe la mappa inversa (target W e Nm → W/kg → livello /
  potenza / coppia) e, siccome Route dà un **livello fisso** mentre il Tuner può
  dare un **range**, il risultato può non coincidere con la proposta — un'altra
  incoerenza da spiegare all'utente.

Vincoli già individuati:
- **Istantanea, non riferimento**: le proposte sono calcolate con il fattore
  personale e le pendenze di *quel* file; se poi si rimuove la calibrazione o si
  carica altro, i valori trasferiti non devono cambiare da soli (e con la mutua
  esclusione route/ride già attiva, un riferimento "vivo" punterebbe a dati
  cancellati).
- Etichetta con la sorgente (file o giro + data) accanto ai valori, come fa già
  "Analysis source" nel tab Route.
- **Session-only**, coerente con le ride; il Reset nell'header lo pulisce.
- Bottone sulle card di Route: "Use in Tuner" accanto al Copy esistente.
- Lato server: nessuna modifica necessaria (i dati sono già tutti client-side
  dopo `/api/route-modes`).

