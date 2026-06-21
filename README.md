# Avinox Setup Calculator

Calcolatore per l'ottimizzazione dei livelli di assistenza della **DJI Avinox M1/M2** su e-bike. L'applicazione stima le configurazioni ottimali per le modalità ECO, AUTO, TRAIL e TURBO basandosi sul rapporto potenza/peso del sistema (ciclista + bici) e sulla cadenza di pedalata.

## Funzionamento

Il sistema riceve in input:
- Peso ciclista (kg, equipaggiato)
- Peso bici (kg)
- Cadenza bersaglio (RPM)
- Potenza umana erogata (W)

Il backend calcola automaticamente i parametri di ogni modalità utilizzando target prestabiliti in W/kg e una mappatura reale degli assist level (rapporti di supporto motore da 30% a 950%).

## Stack

- **Backend:** TypeScript + Express
- **Frontend:** HTML statico + Tailwind CSS + Axios
- **Build:** TypeScript compiler
- **Deploy:** Docker (multi-stage build su Alpine)

## Script

| Comando | Descrizione |
|---|---|
| `npm start` | Avvia in development con ts-node |
| `npm run build` | Compila TypeScript in dist/ |
| `npm run serve` | Avvia la versione compilata in produzione |

## Docker

```bash
docker build -t avinox-setup-app .
docker run -p 3000:3080 avinox-setup-app
```

L'applicazione ascolta sulla porta **3080** in sviluppo; il Dockerfile espone la porta **3000** per convenienza.
