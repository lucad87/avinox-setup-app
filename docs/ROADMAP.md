# Avinox Calc — Roadmap

Stato aggiornato: 2026-09-23 · versione corrente: **2.0.0**

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
