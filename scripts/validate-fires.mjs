import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerArgument = process.argv.find((value) => value.startsWith('--worker='));
const workerPath = path.resolve(ROOT, workerArgument ? workerArgument.slice('--worker='.length) : 'public/simulation.worker.js');
const checkpointsOnly = process.argv.includes('--checkpoints-only');

function engine() {
  const self = { postMessage() {} };
  const context = vm.createContext({ self, Math, Number, String, Array, Object, Infinity, Uint8Array, Uint16Array, Float32Array, Map, Set, atob: globalThis.atob });
  vm.runInContext(fs.readFileSync(workerPath, 'utf8'), context);
  return self.__fireopsTest;
}

const saumos2022Perimeter = JSON.parse(fs.readFileSync(path.join(ROOT, 'validation-data/saumos-2022-emsr633.geojson'), 'utf8'));
const girondeLandscape = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/gironde-landscape.json'), 'utf8'));
const weather2022 = JSON.parse(fs.readFileSync(path.join(ROOT, 'validation-data/saumos-2022-weather.json'), 'utf8')).weatherSeries;
const weather2026 = JSON.parse(fs.readFileSync(path.join(ROOT, 'validation-data/saumos-2026-weather.json'), 'utf8')).weatherSeries;
const SAUMOS_IGNITION = { lng: -0.987, lat: 44.921, radiusM: 0 };
const SAUMOS_TERRAIN = {
  region: 'gironde', oceanWestOfLng: -1.205,
  water: [{ lng: -1.135, lat: 44.990, radiusM: 3200 }, { lng: -1.130, lat: 44.680, radiusM: 7000 }],
  urban: [{ lng: -1.078, lat: 44.980, radiusM: 1500 }, { lng: -1.091, lat: 44.874, radiusM: 1300 }, { lng: -0.987, lat: 44.921, radiusM: 700 }],
};
const SAUMOS_2026_DEPLOYMENTS = [
  { id: 'sccf1', type: 'CCF', count: 45, lng: -0.9870, lat: 44.8671, radiusM: 5000, autonomy: 85 },
  { id: 'sccf2', type: 'CCF', count: 45, lng: -0.9330, lat: 44.8828, radiusM: 5000, autonomy: 85 },
  { id: 'sccf3', type: 'CCF', count: 40, lng: -1.0678, lat: 44.8639, radiusM: 5000, autonomy: 85 },
  { id: 'sfpt1', type: 'FPT', count: 30, lng: -1.1298, lat: 44.8841, radiusM: 4500, autonomy: 85 },
  { id: 'scl41', type: 'CL4', count: 9, lng: -1.0872, lat: 44.9085, radiusM: 6000, autonomy: 80 },
  { id: 'shbe1', type: 'HBE', count: 9, lng: -1.0170, lat: 44.8618, radiusM: 5000, autonomy: 75 },
  { id: 'sdoz1', type: 'DOZ', count: 30, lng: -1.1521, lat: 44.9210, radiusM: 5500, autonomy: 85 },
];

const FIRES = [
  {
    name: 'Saumos 2022 · EMSR633', ignition: SAUMOS_IGNITION,
    domain: { lng: -0.955, lat: 44.935, boxMetres: 25000 }, terrain: SAUMOS_TERRAIN,
    startHour: 13, weather: { temperature: 28, humidity: 34, droughtIndex: 0.78, windKph: 18, windBearingDegrees: 45 },
    weatherSeries: weather2022,
    deployments: [], measureNight: false,
    checkpoints: [{ label: '20/09 · Monit01', minutes: 8 * 1440, actualHa: 3248.39648665, perimeter: saumos2022Perimeter }],
  },
  {
    name: 'Saumos 2026 · surfaces publiées', ignition: SAUMOS_IGNITION,
    domain: { lng: -1.10, lat: 44.80, boxMetres: 50000 }, terrain: SAUMOS_TERRAIN,
    startHour: 13.5, weather: { temperature: 38, humidity: 22, droughtIndex: 0.96, windKph: 26, windBearingDegrees: 225 },
    weatherSeries: weather2026,
    deployments: SAUMOS_2026_DEPLOYMENTS, measureNight: true, measureSuppression: true,
    checkpoints: [
      { label: '22/07', minutes: 630, actualHa: 1400 },
      { label: '23/07', minutes: 2070, actualHa: 4800 },
      { label: '24/07', minutes: 3510, actualHa: 19000 },
      { label: '25/07', minutes: 4950, actualHa: 32000 },
      { label: '26/07', minutes: 6390, actualHa: 42000 },
    ],
  },
];

function polygonsOf(featureCollection) {
  const geometries = featureCollection.type === 'FeatureCollection'
    ? featureCollection.features.map((feature) => feature.geometry)
    : [featureCollection.geometry || featureCollection];
  return geometries.flatMap((geometry) => geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []);
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function contains(polygons, point) {
  return polygons.some((rings) => pointInRing(point, rings[0]) && !rings.slice(1).some((hole) => pointInRing(point, hole)));
}

function jaccard(model, observed, samples = 420) {
  const a = polygonsOf(model), b = polygonsOf(observed);
  const points = [...a, ...b].flat(2);
  if (!points.length) return null;
  const west = Math.min(...points.map((point) => point[0]));
  const east = Math.max(...points.map((point) => point[0]));
  const south = Math.min(...points.map((point) => point[1]));
  const north = Math.max(...points.map((point) => point[1]));
  let intersection = 0, union = 0;
  for (let y = 0; y < samples; y += 1) for (let x = 0; x < samples; x += 1) {
    const point = [west + (x + 0.5) * (east - west) / samples, south + (y + 0.5) * (north - south) / samples];
    const inA = contains(a, point), inB = contains(b, point);
    if (inA || inB) union += 1;
    if (inA && inB) intersection += 1;
  }
  return union ? intersection / union : 0;
}

const rows = [];
const summaries = [];
for (const fire of FIRES) {
  const simulator = engine();
  let previousMinutes = 0, previousHa = 0, nightGrowthHa = 0, totalGrowthHa = 0;
  const checkpoints = new Map(fire.checkpoints.map((checkpoint) => [checkpoint.minutes, checkpoint]));
  const lastMinute = fire.checkpoints.at(-1).minutes;
  const timeline = checkpointsOnly || !fire.measureNight ? fire.checkpoints.map((checkpoint) => checkpoint.minutes) : [...new Set([
    ...Array.from({ length: Math.ceil(lastMinute / 180) }, (_, index) => Math.min(lastMinute, (index + 1) * 180)),
    ...fire.checkpoints.map((checkpoint) => checkpoint.minutes),
  ])].sort((a, b) => a - b);
  for (const targetMinutes of timeline) {
    const result = simulator.simulate({
      reset: previousMinutes === 0, independent: false, targetMinutes,
      ignitionLngLat: fire.ignition, domain: fire.domain, terrain: fire.terrain,
      startHour: fire.startHour, ...fire.weather, weatherSeries: fire.weatherSeries, landscape: girondeLandscape,
      deployments: fire.deployments, spotting: true,
    });
    const growth = result.totalBurnedHa - previousHa;
    const midpointHour = ((fire.startHour + (previousMinutes + targetMinutes) / 120) % 24 + 24) % 24;
    if (midpointHour < 6.5 || midpointHour > 21.5) nightGrowthHa += growth;
    totalGrowthHa += growth;
    const checkpoint = checkpoints.get(targetMinutes);
    if (checkpoint) {
      const score = checkpoint.perimeter ? jaccard(result.perimeterGeoJSON, checkpoint.perimeter) : null;
      rows.push({ fire: fire.name, deadline: checkpoint.label, actualHa: checkpoint.actualHa,
        modelHa: result.totalBurnedHa, errorPct: 100 * (result.totalBurnedHa - checkpoint.actualHa) / checkpoint.actualHa,
        jaccard: score });
    }
    previousMinutes = targetMinutes;
    previousHa = result.totalBurnedHa;
  }
  let withoutSuppressionHa = null;
  if (fire.measureSuppression) {
    withoutSuppressionHa = engine().simulate({ independent: true, targetMinutes: lastMinute,
      ignitionLngLat: fire.ignition, domain: fire.domain, terrain: fire.terrain, landscape: girondeLandscape,
      startHour: fire.startHour, ...fire.weather, weatherSeries: fire.weatherSeries, deployments: [], spotting: true }).totalBurnedHa;
  }
  summaries.push({ fire: fire.name, nightSharePct: fire.measureNight && totalGrowthHa > 0 ? 100 * nightGrowthHa / totalGrowthHa : null,
    nightGrowthHa: fire.measureNight ? nightGrowthHa : null,
    dayGrowthHa: fire.measureNight ? totalGrowthHa - nightGrowthHa : null,
    withSuppressionHa: fire.measureSuppression ? previousHa : null, withoutSuppressionHa });
}

console.log(`Validation FireOps · worker ${path.relative(ROOT, workerPath)}`);
console.log('| Feu | Échéance | Réel (ha) | Modèle (ha) | Écart | Jaccard |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
for (const row of rows) console.log(`| ${row.fire} | ${row.deadline} | ${row.actualHa.toFixed(0)} | ${row.modelHa.toFixed(0)} | ${row.errorPct >= 0 ? '+' : ''}${row.errorPct.toFixed(1)} % | ${row.jaccard === null ? 'n/d' : row.jaccard.toFixed(3)} |`);
for (const summary of summaries) {
  console.log(`${summary.fire} · croissance nocturne estimée: ${summary.nightSharePct === null ? 'n/d' : `${summary.nightSharePct.toFixed(1)} %`}`);
  if (summary.nightGrowthHa !== null) console.log(`${summary.fire} · croissance par régime: ${summary.dayGrowthHa.toFixed(0)} ha de jour / ${summary.nightGrowthHa.toFixed(0)} ha de nuit`);
  if (summary.withoutSuppressionHa !== null) console.log(`${summary.fire} · effet des moyens: ${summary.withoutSuppressionHa.toFixed(0)} ha sans / ${summary.withSuppressionHa.toFixed(0)} ha avec (${(100 * (1 - summary.withSuppressionHa / summary.withoutSuppressionHa)).toFixed(1)} % évités)`);
}
console.log('Mesure uniquement : ce script ne modifie ni les coefficients ni les données du moteur.');
