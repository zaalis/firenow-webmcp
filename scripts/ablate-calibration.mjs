/**
 * Calibration ablation.
 *
 * `validate-fires.mjs` reports that the engine over-predicts Saumos 2022 by
 * 158 % and under-predicts Saumos 2026 by 92 %. Two errors of opposite sign
 * from one engine cannot both come from a wrong constant, so this script varies
 * one term at a time and prints what each is worth. It changes nothing: it is a
 * measuring instrument, not a fix.
 *
 *     node scripts/ablate-calibration.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(ROOT, 'public/simulation.worker.js');

/** Loads the worker, optionally rewriting constants before evaluation. */
function engine(patches = []) {
  let source = fs.readFileSync(WORKER, 'utf8');
  for (const [from, to] of patches) {
    if (!source.includes(from)) throw new Error('patch introuvable: ' + from);
    source = source.replace(from, to);
  }
  const self = { postMessage() {} };
  const context = vm.createContext({ self, Math, Number, String, Array, Object, Infinity, Uint8Array, Uint16Array, Float32Array, Map, Set, atob: globalThis.atob });
  vm.runInContext(source, context);
  return self.__firenowTest;
}

const landscape = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/gironde-landscape.json'), 'utf8'));
const weather2022 = JSON.parse(fs.readFileSync(path.join(ROOT, 'validation-data/saumos-2022-weather.json'), 'utf8')).weatherSeries;
const weather2026 = JSON.parse(fs.readFileSync(path.join(ROOT, 'validation-data/saumos-2026-weather.json'), 'utf8')).weatherSeries;

const IGNITION = { lng: -0.987, lat: 44.921, radiusM: 0 };
const TERRAIN = {
  region: 'gironde', oceanWestOfLng: -1.205,
  water: [{ lng: -1.135, lat: 44.990, radiusM: 3200 }, { lng: -1.130, lat: 44.680, radiusM: 7000 }],
  urban: [{ lng: -1.078, lat: 44.980, radiusM: 1500 }, { lng: -1.091, lat: 44.874, radiusM: 1300 }, { lng: -0.987, lat: 44.921, radiusM: 700 }],
};

const F2022 = {
  label: 'Saumos 2022', actualHa: 3248, minutes: 8 * 1440, startHour: 13,
  domain: { lng: -0.955, lat: 44.935, boxMetres: 25000 },
  weather: { temperature: 28, humidity: 34, droughtIndex: 0.78, windKph: 18, windBearingDegrees: 45 },
  weatherSeries: weather2022,
};
const F2026 = {
  label: 'Saumos 2026', actualHa: 42000, minutes: 6390, startHour: 13.5,
  domain: { lng: -1.10, lat: 44.80, boxMetres: 50000 },
  weather: { temperature: 38, humidity: 22, droughtIndex: 0.96, windKph: 26, windBearingDegrees: 225 },
  weatherSeries: weather2026,
};

function run(fire, { patches = [], domain, deployments = [] } = {}) {
  const result = engine(patches).simulate({
    independent: true, targetMinutes: fire.minutes,
    ignitionLngLat: IGNITION, domain: domain || fire.domain, terrain: TERRAIN, landscape,
    startHour: fire.startHour, ...fire.weather, weatherSeries: fire.weatherSeries,
    deployments, spotting: true,
  });
  return { ha: result.totalBurnedHa, cell: result.gridMeters, extinguished: result.extinguishedEdgeCells };
}

const line = (name, fire, out) => {
  const error = 100 * (out.ha - fire.actualHa) / fire.actualHa;
  console.log(
    name.padEnd(46)
    + String(Math.round(out.ha)).padStart(8) + ' ha'
    + ((error >= 0 ? '  +' : '  ') + error.toFixed(0) + ' %').padStart(11)
    + ('  cell ' + out.cell.toFixed(0) + ' m').padStart(14),
  );
};

console.log('Reference (real): Saumos 2022 = 3,248 ha over 8 days · Saumos 2026 = 42,000 ha over 4.4 days');
console.log('All runs below are FREE SPREAD (no units) unless stated.\n');

console.log('--- Baseline, as shipped ---');
line('2022 baseline', F2022, run(F2022));
line('2026 baseline', F2026, run(F2026));

console.log('\n--- A. Grid resolution (same fire, different window) ---');
line('2022 in a 50 km window (390 m cells)', F2022, run(F2022, { domain: { ...F2022.domain, boxMetres: 50000 } }));
line('2026 in a 25 km window (195 m cells, clips)', F2026, run(F2026, { domain: { ...F2026.domain, boxMetres: 25000 } }));

console.log('\n--- B. Perimeter death disabled ---');
const noDeath = [['    const weak = intensity < 500 || wetRear || treated;', '    const weak = false;']];
line('2022 without edge extinction', F2022, run(F2022, { patches: noDeath }));
line('2026 without edge extinction', F2026, run(F2026, { patches: noDeath }));

console.log('\n--- C. Diurnal damping removed ---');
const noNight = [['const NIGHT_WAF_FLOOR = 0.35;', 'const NIGHT_WAF_FLOOR = 1;'], ['const NIGHT_ACTIVE_FRACTION = 0.18;', 'const NIGHT_ACTIVE_FRACTION = 1;']];
line('2022 without diurnal damping', F2022, run(F2022, { patches: noNight }));
line('2026 without diurnal damping', F2026, run(F2026, { patches: noNight }));

console.log('\n--- D. Hourly weather series ignored (constant peak weather) ---');
line('2022 constant weather', { ...F2022, weatherSeries: null }, run({ ...F2022, weatherSeries: null }));
line('2026 constant weather', { ...F2026, weatherSeries: null }, run({ ...F2026, weatherSeries: null }));

console.log('\n--- E. Midflame wind adjustment factor ---');
for (const waf of [0.35, 0.5]) {
  const patch = [['const MIDFLAME_FACTOR = 0.25;', `const MIDFLAME_FACTOR = ${waf};`]];
  line(`2022 with WAF ${waf}`, F2022, run(F2022, { patches: patch }));
  line(`2026 with WAF ${waf}`, F2026, run(F2026, { patches: patch }));
}

console.log('\n--- F. Suppression term, 2026 only ---');
const DEPLOYMENTS = [
  { id: 'sccf1', type: 'CCF', count: 45, lng: -0.9870, lat: 44.8671, radiusM: 5000, autonomy: 85 },
  { id: 'sccf2', type: 'CCF', count: 45, lng: -0.9330, lat: 44.8828, radiusM: 5000, autonomy: 85 },
  { id: 'sccf3', type: 'CCF', count: 40, lng: -1.0678, lat: 44.8639, radiusM: 5000, autonomy: 85 },
  { id: 'sfpt1', type: 'FPT', count: 30, lng: -1.1298, lat: 44.8841, radiusM: 4500, autonomy: 85 },
  { id: 'scl41', type: 'CL4', count: 9, lng: -1.0872, lat: 44.9085, radiusM: 6000, autonomy: 80 },
  { id: 'shbe1', type: 'HBE', count: 9, lng: -1.0170, lat: 44.8618, radiusM: 5000, autonomy: 75 },
  { id: 'sdoz1', type: 'DOZ', count: 30, lng: -1.1521, lat: 44.9210, radiusM: 5500, autonomy: 85 },
];
line('2026 with the real deployment', F2026, run(F2026, { deployments: DEPLOYMENTS }));
line('2026 with radii quartered', F2026, run(F2026, { deployments: DEPLOYMENTS.map((u) => ({ ...u, radiusM: u.radiusM / 4 })) }));
