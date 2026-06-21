import express, { Request, Response } from 'express';
import path from 'path';

const app = express();
const port = 3080;

app.use(express.json());

// Istruisce Express a servire i file statici presenti nella cartella 'public' 
app.use(express.static(path.join(__dirname, '../public')));

// Mappatura reale dei livelli di assistenza derivata dai dati del PDF
const ASSIST_LEVELS = [
    { level: 1, ratio: 0.30 },
    { level: 2, ratio: 0.60 },
    { level: 3, ratio: 0.80 },
    { level: 4, ratio: 1.00 },
    { level: 5, ratio: 1.25 },
    { level: 6, ratio: 1.50 },
    { level: 7, ratio: 1.75 },
    { level: 8, ratio: 2.25 },
    { level: 9, ratio: 3.00 },
    { level: 10, ratio: 3.75 },
    { level: 11, ratio: 4.45 },
    { level: 12, ratio: 5.25 },
    { level: 13, ratio: 6.75 },
    { level: 14, ratio: 8.25 },
    { level: 15, ratio: 9.50 }
];

function findNearestAssistLevel(targetRatio: number, minLvl: number, maxLvl: number): number {
    let bestLevel = minLvl;
    let minDiff = Infinity;
    
    for (const al of ASSIST_LEVELS) {
        if (al.level >= minLvl && al.level <= maxLvl) {
            const diff = al.ratio - targetRatio;
            if (diff >= 0 && diff < minDiff) {
                minDiff = diff;
                bestLevel = al.level;
            }
        }
    }
    return bestLevel;
}

// REST API Endpoint per l'elaborazione dei parametri di calcolo
app.post('/api/calculate', (req: Request, res: Response) => {
    const { riderWeight, bikeWeight, cadence, riderPower } = req.body;

    if (!riderWeight || !bikeWeight || !cadence || !riderPower) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    const totalWeight = parseFloat(riderWeight) + parseFloat(bikeWeight); // G
    const rpm = parseFloat(cadence);
    const pRider = parseFloat(riderPower);

    // 1. ECO Mode Optimization (Target: 1.36 W/kg)
    let ecoWatts = Math.round(totalWeight * 1.36);
    ecoWatts = Math.min(Math.max(ecoWatts, 100), 400); // Limiti hardware di memorizzazione
    let ecoNm = Math.round((ecoWatts / rpm) * 9.55); // Formula fisica della potenza
    ecoNm = Math.min(Math.max(ecoNm, 10), 70); // Limiti Nm
    const ecoTargetRatio = ecoWatts / pRider; // Calcolo rapporto assistenza
    const ecoLevel = findNearestAssistLevel(ecoTargetRatio, 1, 7); // Range Eco

    // 2. AUTO Mode Optimization (Target: 2.73 W/kg)
    let autoWatts = Math.round(totalWeight * 2.73);
    autoWatts = Math.min(Math.max(autoWatts, 200), 1000);
    let autoNm = Math.round((autoWatts / rpm) * 9.55);
    autoNm = Math.min(Math.max(autoNm, 10), 105);
    const autoTargetRatio = autoWatts / pRider;
    const autoMaxLevel = findNearestAssistLevel(autoTargetRatio, 3, 11);
    const autoMinLevel = Math.max(3, ecoLevel + 1); // Logica di progressione coerente

    // 3. TRAIL Mode Optimization (Target: 5.45 W/kg)
    let trailWatts = Math.round(totalWeight * 5.45);
    trailWatts = Math.min(Math.max(trailWatts, 300), 1000);
    let trailNm = Math.round((trailWatts / rpm) * 9.55);
    trailNm = Math.min(Math.max(trailNm, 20), 105);
    const trailTargetRatio = trailWatts / pRider;
    const trailMaxLevel = findNearestAssistLevel(trailTargetRatio, 6, 13);
    const trailMinLevel = autoMaxLevel; // Ancoraggio fluido al soffitto di Auto

    // 4. TURBO Mode Optimization (Target: 7.72 W/kg)
    let turboWatts = Math.round(totalWeight * 7.72);
    turboWatts = Math.min(Math.max(turboWatts, 400), 1000);
    let turboNm = Math.round((turboWatts / rpm) * 9.55);
    turboNm = Math.min(Math.max(turboNm, 60), 105);
    const turboTargetRatio = turboWatts / pRider;
    const turboLevel = findNearestAssistLevel(turboTargetRatio, 8, 15);

    res.json({
        totalWeight,
        eco: { level: `Level ${ecoLevel}`, watts: `${ecoWatts} W`, torque: `${ecoNm} Nm`, wkg: (ecoWatts / totalWeight).toFixed(2) },
        auto: { level: `Level ${autoMinLevel} - ${autoMaxLevel}`, watts: `${autoWatts} W`, torque: `${autoNm} Nm`, wkg: (autoWatts / totalWeight).toFixed(2) },
        trail: { level: `Level ${trailMinLevel} - ${trailMaxLevel}`, watts: `${trailWatts} W`, torque: `${trailNm} Nm`, wkg: (trailWatts / totalWeight).toFixed(2) },
        turbo: { level: `Level ${turboLevel}`, watts: `${turboWatts} W`, torque: `${turboNm} Nm`, wkg: (turboWatts / totalWeight).toFixed(2) }
    });
});

app.listen(port, () => {
    console.log(`Avinox Backend Matrix listening at http://localhost:${port}`);
});