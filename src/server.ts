import express, { Request, Response } from 'express';
import path from 'path';

const app = express();
const port = 3080;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Mappatura reale ricavata dai test strumentali del PDF //
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

// REST API Endpoint per l'elaborazione dei parametri di calcolo //
app.post('/api/calculate', (req: Request, res: Response) => {
    const { riderWeight, bikeWeight, cadence, riderPower, ecoWkg, autoWkg, trailWkg, turboWkg } = req.body;

    if (!riderWeight || !bikeWeight || !cadence || !riderPower) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    const totalWeight = parseFloat(riderWeight) + parseFloat(bikeWeight); //
    const rpm = parseFloat(cadence);
    const pRider = parseFloat(riderPower);

    const targetEcoWkg = ecoWkg ? parseFloat(ecoWkg) : 1.36;
    const targetAutoWkg = autoWkg ? parseFloat(autoWkg) : 2.73;
    const targetTrailWkg = trailWkg ? parseFloat(trailWkg) : 5.45;
    const targetTurboWkg = turboWkg ? parseFloat(turboWkg) : 7.72;

    // 1. ECO Mode Optimization (Target: 1.36 W/kg) //
    let ecoWatts = Math.round(totalWeight * targetEcoWkg);
    ecoWatts = Math.min(Math.max(ecoWatts, 100), 400); // Limiti hardware //
    let ecoNm = Math.round((ecoWatts / rpm) * 9.55); // Formula fisica potenza //
    ecoNm = Math.min(Math.max(ecoNm, 10), 70); // Limiti Nm //
    const ecoTargetRatio = ecoWatts / pRider; // Calcolo rapporto assistenza //
    const ecoLevel = findNearestAssistLevel(ecoTargetRatio, 1, 7); // Range Eco //

    // 2. AUTO Mode Optimization (Target: 2.73 W/kg) //
    let autoWatts = Math.round(totalWeight * targetAutoWkg);
    autoWatts = Math.min(Math.max(autoWatts, 200), 1000); //
    let autoNm = Math.round((autoWatts / rpm) * 9.55); //
    autoNm = Math.min(Math.max(autoNm, 10), 105); //
    const autoTargetRatio = autoWatts / pRider; //
    const autoMaxLevel = findNearestAssistLevel(autoTargetRatio, 3, 11); //
    const autoMinLevel = Math.max(3, ecoLevel + 1); // Logica di progressione //

    // 3. TRAIL Mode Optimization (Target: 5.45 W/kg) //
    let trailWatts = Math.round(totalWeight * targetTrailWkg);
    trailWatts = Math.min(Math.max(trailWatts, 300), 1000); //
    let trailNm = Math.round((trailWatts / rpm) * 9.55); //
    trailNm = Math.min(Math.max(trailNm, 20), 105); //
    const trailTargetRatio = trailWatts / pRider; //
    const trailMaxLevel = findNearestAssistLevel(trailTargetRatio, 6, 13); //
    const trailMinLevel = autoMaxLevel; // Ancoraggio al soffitto di Auto //

    // 4. TURBO Mode (Target: 7.72 W/kg) //
    let turboWatts = Math.round(totalWeight * targetTurboWkg);
    turboWatts = Math.min(Math.max(turboWatts, 400), 1000); //
    let turboNm = Math.round((turboWatts / rpm) * 9.55); //
    turboNm = Math.min(Math.max(turboNm, 60), 120); // Sbloccato a 120 Nm per M2S //
    const turboTargetRatio = turboWatts / pRider; //
    const turboLevel = findNearestAssistLevel(turboTargetRatio, 8, 15); //

    res.json({
        totalWeight,
        eco: { level: `Level ${ecoLevel}`, watts: `${ecoWatts} W`, torque: `${ecoNm} Nm`, wkg: (ecoWatts / totalWeight).toFixed(2) },
        auto: { level: `Level ${autoMinLevel} - ${autoMaxLevel}`, watts: `${autoWatts} W`, torque: `${autoNm} Nm`, wkg: (autoWatts / totalWeight).toFixed(2) },
        trail: { level: `Level ${trailMinLevel} - ${trailMaxLevel}`, watts: `${trailWatts} W`, torque: `${trailNm} Nm`, wkg: (trailWatts / totalWeight).toFixed(2) },
        turbo: { level: `Level ${turboLevel}`, watts: `${turboWatts} W`, torque: `${turboNm} Nm`, wkg: (turboWatts / totalWeight).toFixed(2) }
    });
});

app.listen(port, () => {
    console.log(`Avinox Elastic Engine running at http://localhost:${port}`);
});