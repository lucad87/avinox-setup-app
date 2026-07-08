import express, { Request, Response } from 'express';
import path from 'path';

const app = express();
const port = 3080;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const ASSIST_LEVELS = [
    { level: 1, ratio: 0.30 }, { level: 2, ratio: 0.60 }, { level: 3, ratio: 0.80 },
    { level: 4, ratio: 1.00 }, { level: 5, ratio: 1.25 }, { level: 6, ratio: 1.50 },
    { level: 7, ratio: 1.75 }, { level: 8, ratio: 2.25 }, { level: 9, ratio: 3.00 },
    { level: 10, ratio: 3.75 }, { level: 11, ratio: 4.45 }, { level: 12, ratio: 5.25 },
    { level: 13, ratio: 6.75 }, { level: 14, ratio: 8.25 }, { level: 15, ratio: 9.50 }
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

function calculateMetrics(watts: number, speedKmH: number, batteryWh: number) {
    const runtimeHours = batteryWh / watts;
    const rangeKm = runtimeHours * speedKmH;
    return {
        runtime: parseFloat(runtimeHours.toFixed(1)),
        range: parseFloat(rangeKm.toFixed(0))
    };
}

app.post('/api/calculate', (req: Request, res: Response) => {
    const { riderWeight, bikeWeight, cadence, riderPower, ecoWkg, autoWkg, trailWkg, turboWkg, batteryWh } = req.body;
    if (!riderWeight || !bikeWeight || !cadence || !riderPower) {
        return res.status(400).json({ error: 'Missing parameters' });
    }
    const totalWeight = parseFloat(riderWeight) + parseFloat(bikeWeight); //
    const rpm = parseFloat(cadence);
    const pRider = parseFloat(riderPower);
    const currentBattery = batteryWh ? parseInt(batteryWh) : 800; //

    const targetEcoWkg = ecoWkg ? parseFloat(ecoWkg) : 1.36;
    const targetAutoWkg = autoWkg ? parseFloat(autoWkg) : 2.73;
    const targetTrailWkg = trailWkg ? parseFloat(trailWkg) : 5.45;
    const targetTurboWkg = turboWkg ? parseFloat(turboWkg) : 7.72;

    let ecoWatts = Math.round(totalWeight * targetEcoWkg); ecoWatts = Math.min(Math.max(ecoWatts, 100), 400); //
    let ecoNm = Math.round((ecoWatts / rpm) * 9.55); ecoNm = Math.min(Math.max(ecoNm, 10), 70); //
    const ecoLevel = findNearestAssistLevel(ecoWatts / pRider, 1, 7); //
    const ecoMetrics = calculateMetrics(ecoWatts, 22, currentBattery);

    let autoWatts = Math.round(totalWeight * targetAutoWkg); autoWatts = Math.min(Math.max(autoWatts, 200), 1000); //
    let autoNm = Math.round((autoWatts / rpm) * 9.55); autoNm = Math.min(Math.max(autoNm, 10), 105); //
    const autoMaxLevel = findNearestAssistLevel(autoWatts / pRider, 3, 11); //
    const autoMinLevel = Math.max(3, ecoLevel + 1); //
    const autoMetrics = calculateMetrics(autoWatts, 18, currentBattery);

    let trailWatts = Math.round(totalWeight * targetTrailWkg); trailWatts = Math.min(Math.max(trailWatts, 300), 1000); //
    let trailNm = Math.round((trailWatts / rpm) * 9.55); trailNm = Math.min(Math.max(trailNm, 20), 105); //
    const trailMaxLevel = findNearestAssistLevel(trailWatts / pRider, 6, 13); //
    const trailMinLevel = autoMaxLevel; //
    const trailMetrics = calculateMetrics(trailWatts, 14, currentBattery);

    let turboWatts = Math.round(totalWeight * targetTurboWkg); turboWatts = Math.min(Math.max(turboWatts, 400), 1000); //
    let turboNm = Math.round((turboWatts / rpm) * 9.55); turboNm = Math.min(Math.max(turboNm, 60), 120); //
    const turboLevel = findNearestAssistLevel(turboWatts / pRider, 8, 15); //
    const turboMetrics = calculateMetrics(turboWatts, 10, currentBattery);

    res.json({
        totalWeight,
        eco: { level: `Level ${ecoLevel}`, watts: `${ecoWatts} W`, torque: `${ecoNm} Nm`, wkg: (ecoWatts / totalWeight).toFixed(2), range: ecoMetrics.range, runtime: ecoMetrics.runtime },
        auto: { level: `Level ${autoMinLevel} - ${autoMaxLevel}`, watts: `${autoWatts} W`, torque: `${autoNm} Nm`, wkg: (autoWatts / totalWeight).toFixed(2), range: autoMetrics.range, runtime: autoMetrics.runtime },
        trail: { level: `Level ${trailMinLevel} - ${trailMaxLevel}`, watts: `${trailWatts} W`, torque: `${trailNm} Nm`, wkg: (trailWatts / totalWeight).toFixed(2), range: trailMetrics.range, runtime: trailMetrics.runtime },
        turbo: { level: `Level ${turboLevel}`, watts: `${turboWatts} W`, torque: `${turboNm} Nm`, wkg: (turboWatts / totalWeight).toFixed(2), range: turboMetrics.range, runtime: turboMetrics.runtime }
    });
});

// ROUTE 2: Tour Planner con calcolo distribuzione per grafico a torta
app.post('/api/calculate-mission', (req: Request, res: Response) => {
    const { riderWeight, bikeWeight, cadence, riderPower, targetKm, targetH_m, batteryWh } = req.body;

    const totalWeight = parseFloat(riderWeight) + parseFloat(bikeWeight); //
    const rpm = parseFloat(cadence);
    const pRider = parseFloat(riderPower);
    const km = parseFloat(targetKm);
    const hm = parseFloat(targetH_m);
    const currentBattery = batteryWh ? parseInt(batteryWh) : 800; //

    const energyFlat = km * 3.8; 
    const energyClimb = hm * 0.24 * (totalWeight / 100); 
    const totalEnergyRequired = Math.round(energyFlat + energyClimb);

    let scalingFactor = 1.0;
    let feasible = true;

    if (totalEnergyRequired > currentBattery) {
        scalingFactor = currentBattery / totalEnergyRequired;
        feasible = false;
    }

    // Calcolo della quota altimetrica e pianificazione d'uso dei profili (Pie Chart Logic)
    const climbRatio = energyClimb / (energyFlat + energyClimb || 1);
    const flatRatio = 1 - climbRatio;

    // Ripartizione teorica iniziale basata sul tipo di terreno
    let ecoPercent = (40 * flatRatio) + (15 * climbRatio);
    let autoPercent = (50 * flatRatio) + (45 * climbRatio);
    let trailPercent = (10 * flatRatio) + (32 * climbRatio);
    let turboPercent = (0 * flatRatio) + (8 * climbRatio);

    if (!feasible) {
        // Se il giro è critico, riduciamo drasticamente il Turbo e il Trail per forzare l'uso di Eco/Auto
        turboPercent = turboPercent * Math.pow(scalingFactor, 2);
        trailPercent = trailPercent * scalingFactor;
        autoPercent = autoPercent * (0.4 + 0.6 * scalingFactor);
        ecoPercent = 100 - (turboPercent + trailPercent + autoPercent);
    }

    const totalPercentSum = ecoPercent + autoPercent + trailPercent + turboPercent;
    const distribution = {
        eco: Math.max(0, Math.round((ecoPercent / totalPercentSum) * 100)),
        auto: Math.max(0, Math.round((autoPercent / totalPercentSum) * 100)),
        trail: Math.max(0, Math.round((trailPercent / totalPercentSum) * 100)),
        turbo: Math.max(0, Math.round((turboPercent / totalPercentSum) * 100))
    };

    const finalSum = distribution.eco + distribution.auto + distribution.trail + distribution.turbo;
    if (finalSum !== 100) distribution.eco += (100 - finalSum);

    const ecoWkg = Math.max(0.75, 1.36 * scalingFactor);
    const autoWkg = Math.max(1.50, 2.73 * scalingFactor);
    const trailWkg = Math.max(2.50, 5.45 * scalingFactor);
    const turboWkg = Math.max(3.50, 7.72 * scalingFactor);

    let ecoW = Math.round(totalWeight * ecoWkg); ecoW = Math.min(Math.max(ecoW, 100), 400); //
    let ecoNm = Math.round((ecoW / rpm) * 9.55); ecoNm = Math.min(Math.max(ecoNm, 10), 70); //
    const ecoLvl = findNearestAssistLevel(ecoW / pRider, 1, 7); //

    let autoW = Math.round(totalWeight * autoWkg); autoW = Math.min(Math.max(autoW, 200), 1000); //
    let autoNm = Math.round((autoW / rpm) * 9.55); autoNm = Math.min(Math.max(autoNm, 10), 105); //
    const autoMaxLvl = findNearestAssistLevel(autoW / pRider, 3, 11); //
    const autoMinLvl = Math.max(3, ecoLvl + 1); //

    let trailW = Math.round(totalWeight * trailWkg); trailW = Math.min(Math.max(trailW, 300), 1000); //
    let trailNm = Math.round((trailW / rpm) * 9.55); trailNm = Math.min(Math.max(trailNm, 20), 105); //
    const trailMaxLvl = findNearestAssistLevel(trailW / pRider, 6, 13); //

    let turboW = Math.round(totalWeight * turboWkg); turboW = Math.min(Math.max(turboW, 400), 1000); //
    let turboNm = Math.round((turboW / rpm) * 9.55); turboNm = Math.min(Math.max(turboNm, 60), 120); //
    const turboLvl = findNearestAssistLevel(turboW / pRider, 8, 15); //

    res.json({
        feasible,
        energyRequired: totalEnergyRequired,
        scalingFactor,
        distribution,
        eco: { level: `Level ${ecoLvl}`, watts: `${ecoW} W`, torque: `${ecoNm} Nm`, wkg: ecoWkg.toFixed(2) },
        auto: { level: `Level ${autoMinLvl} - ${autoMaxLvl}`, watts: `${autoW} W`, torque: `${autoNm} Nm`, wkg: autoWkg.toFixed(2) },
        trail: { level: `Level ${autoMaxLvl} - ${trailMaxLvl}`, watts: `${trailW} W`, torque: `${trailNm} Nm`, wkg: trailWkg.toFixed(2) },
        turbo: { level: `Level ${turboLvl}`, watts: `${turboW} W`, torque: `${turboNm} Nm`, wkg: turboWkg.toFixed(2) }
    });
});

app.listen(port, () => {
    console.log(`Avinox Mission Router running on port ${port}`);
});