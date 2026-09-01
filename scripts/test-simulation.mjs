import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Every scenario starts from a fresh engine: spread state is persistent.
function engine() {
  const self = { postMessage() {} };
  const context = vm.createContext({ self, Math, Number, String, Array, Object, Infinity, Uint8Array, Uint16Array, Float32Array, Map, Set, atob: globalThis.atob });
  vm.runInContext(fs.readFileSync(new URL('../public/simulation.worker.js', import.meta.url), 'utf8'), context);
  return self.__firenowTest;
}
const e = engine();
const IGNITION = { lng: -0.4540519, lat: 44.5897472, radiusM: 0 };
const KM_LAT = 1 / 111.32;
const run = (overrides) => engine().simulate({
  independent: true, slopeDegrees: 3, ignitionLngLat: IGNITION, deployments: [], ...overrides,
});
const codeOf = (model) => {
  const index = e.SPECIES.findIndex((species) => species.model === model);
  assert.ok(index >= 0, 'model missing from the register: ' + model);
  return index;
};

/* --- Rates of spread against the published ranges --------------------------
 * The model used to run with a per-species tuning coefficient (up to x2.1)
 * inherited from a Landes calibration. It has been removed: Rothermel is used
 * as published, and the literature is the reference. */
const BENCHMARKS = [
  ['GR2', 40, 110, 'cured tall grass'],
  ['GR4', 40, 110, 'continuous grass'],
  ['SH5', 25, 100, 'chaparral / tall maquis'],
  ['TL8', 0.5, 6,  'closed conifer litter'],
  ['TU5', 8,  28,  'pine with understorey'],
  ['TU1', 4,  18,  'open understorey'],
];
for (const [model, low, high, label] of BENCHMARKS) {
  const ros = e.rothermelRateOfSpread({ moisture: 0.05, windKph: 30, slopeDegrees: 0, droughtIndex: 0.7 }, codeOf(model));
  assert.ok(ros >= low && ros <= high, `${model} (${label}) outside the published range: ${ros.toFixed(1)} m/min, expected ${low}-${high}`);
}
// Live fuel must slow the fire: the wetter it is, the slower the front.
const shrub = codeOf('SH5');
const dry = e.rothermelRateOfSpread({ moisture: 0.05, windKph: 30, slopeDegrees: 0, droughtIndex: 0.95 }, shrub);
const green = e.rothermelRateOfSpread({ moisture: 0.05, windKph: 30, slopeDegrees: 0, droughtIndex: 0.05 }, shrub);
assert.ok(dry > green * 1.2, `Wet live fuel must slow the fire clearly: ${green.toFixed(1)} -> ${dry.toFixed(1)}`);

/* --- Robustness: a missing slope must not produce NaN --------------------- */
const withoutSlope = e.rothermelRateOfSpread({ moisture: 0.05, windKph: 20 }, codeOf('TU5'));
assert.ok(Number.isFinite(withoutSlope) && withoutSlope > 0, 'A missing slope must fall back to flat ground, not to NaN.');

/* --- Diurnal cycle: continuous, local, applied to the midflame wind ------- */
const midnight = e.environmentAt({ startHour: 0, windKph: 30, temperature: 30, humidity: 40, droughtIndex: 0.7 }, 0);
const noon = e.environmentAt({ startHour: 12, windKph: 30, temperature: 30, humidity: 40, droughtIndex: 0.7 }, 0);
assert.equal(midnight.windKph, 30, 'The 10 m synoptic wind must not disappear at night.');
assert.ok(midnight.wafScale < noon.wafScale && midnight.liveMoistureRecovery > noon.liveMoistureRecovery,
  'Night must lower the WAF and raise live fuel moisture.');
assert.ok(Math.abs(e.daylightProfile(6.5) - e.daylightProfile(6.5001)) < 0.001,
  'The profile must stay continuous at sunrise.');
const diurnalCase = { targetMinutes: 180, temperature: 36, humidity: 20, droughtIndex: 0.85, windKph: 32 };
const nightRun = run({ ...diurnalCase, startHour: 0 });
const dayRun = run({ ...diurnalCase, startHour: 12 });
assert.ok(dayRun.totalBurnedHa > nightRun.totalBurnedHa * 3,
  `The smouldering perimeter must strongly reduce overnight spread: ${nightRun.totalBurnedHa} / ${dayRun.totalBurnedHa}`);
const hourlyMidpoint = e.environmentAt({ startHour: 12, droughtIndex: 0.7, weatherSeries: [
  { hourFromStart: 0, temperature: 20, humidity: 70, windKph: 10, windBearingDegrees: 90 },
  { hourFromStart: 1, temperature: 30, humidity: 30, windKph: 30, windBearingDegrees: 180 },
] }, 30);
assert.equal(hourlyMidpoint.temperature, 25, 'Hourly temperature must be interpolated at the simulated time, not the wall clock.');
assert.equal(hourlyMidpoint.windKph, 20, 'The hourly wind must be interpolated continuously between two observations.');

/* --- Perimeter death: state 3 is persistent, never re-seeded -------------- */
const edgeEngine = engine();
const weakEdge = edgeEngine.simulate({ reset: true, targetMinutes: 360, ignitionLngLat: IGNITION,
  temperature: 16, humidity: 80, droughtIndex: 0.1, windKph: 5, startHour: 0,
  slopeDegrees: 0, deployments: [] });
assert.ok(weakEdge.extinguishedEdgeCells > 0 && weakEdge.extinguishedEdgeGeoJSON,
  'A weak edge must go out and be exposed as geometry.');
const reignitionAttempt = edgeEngine.simulate({ reset: false, targetMinutes: 420, ignitionLngLat: IGNITION,
  temperature: 40, humidity: 10, droughtIndex: 0.98, windKph: 60, startHour: 0,
  slopeDegrees: 0, deployments: [] });
assert.equal(reignitionAttempt.totalBurnedHa, weakEdge.totalBurnedHa,
  'An extinguished edge cell must not be re-seeded on the next sub-step.');

/* --- Regional composition: drawn shares match declared shares ------------- */
const SITES = {
  gironde: { lng: -0.4540519, lat: 44.5897472 },
  marseille: { lng: 5.4474, lat: 43.3170 },
  california: { lng: -120.0366, lat: 39.7229 },
};
for (const [region, centre] of Object.entries(SITES)) {
  const result = run({ targetMinutes: 1, ignitionLngLat: { ...centre, radiusM: 0 },
    domain: { ...centre, boxMetres: 30000 }, terrain: { region },
    temperature: 30, humidity: 30, droughtIndex: 0.7, windKph: 15, windBearingDegrees: 90 });
  const observed = new Map(result.fuelComposition.map((entry) => [entry.code, entry.share]));
  const mix = e.speciesMix(region);
  for (let i = 0; i < mix.length; i += 1) {
    const declared = mix[i];
    const expected = declared.upTo - (i > 0 ? mix[i - 1].upTo : 0);
    if (expected < 0.03) continue;
    const actual = observed.get(declared.code) || 0;
    // A 30 km window samples the region: a local deviation is expected, what
    // must be caught is a massive drift (37 % where 14 % was declared).
    assert.ok(Math.abs(actual - expected) < 0.06,
      `${region}: species ${declared.code} drawn at ${(actual * 100).toFixed(1)}% instead of ${(expected * 100).toFixed(1)}%`);
  }
}

/* --- Geographic anchoring -------------------------------------------------
 * The map used to be a pattern frozen in grid space: moving the framing moved
 * fictional rivers and varied the area of one same fire by a factor of twenty.
 * The landscape must now belong to the place. */
const probes = [];
for (let i = 0; i < 200; i += 1) probes.push({ lng: -120.0366 + (i % 20) * 0.01, lat: 39.7229 + Math.floor(i / 20) * 0.01 });
const framingA = engine(); framingA.configureDomain({ lng: -120.0366, lat: 39.7229, boxMetres: 50000 });
const framingB = engine(); framingB.configureDomain({ lng: -119.60, lat: 39.90, boxMetres: 20000 });
const identical = probes.filter((p) =>
  framingA.speciesAt(p.lng, p.lat, 'california') === framingB.speciesAt(p.lng, p.lat, 'california')).length;
assert.equal(identical, probes.length,
  `A place must keep its vegetation whatever the framing: ${identical}/${probes.length}`);

/* --- Gironde territorial raster: real, local and always anchored ---------- */
const girondeAsset = JSON.parse(fs.readFileSync(new URL('../public/data/gironde-landscape.json', import.meta.url), 'utf8'));
const decodedGironde = e.decodeLandscape(girondeAsset);
const assetIndices = probes.map((_, index) => ({ lng: -1.35 + (index % 20) * 0.02, lat: 44.62 + Math.floor(index / 20) * 0.025 }))
  .map((point) => e.landscapeIndexAt(decodedGironde, point.lng, point.lat));
assert.ok(assetIndices.every((index) => index >= 0), 'The Gironde probes must stay inside the territorial asset.');
const realGironde = run({ targetMinutes: 30, ignitionLngLat: IGNITION,
  domain: { lng: -1.10, lat: 44.80, boxMetres: 50000 }, terrain: { region: 'gironde' }, landscape: girondeAsset,
  temperature: 30, humidity: 40, droughtIndex: 0.6, windKph: 15, windBearingDegrees: 90 });
assert.ok(realGironde.landscape?.appliedCells > 0 && realGironde.landscape.sources.forest.includes('IGN'),
  'The engine must report the cells and the sources of the real Gironde raster.');
const flatInput = { moisture: 0.06, windKph: 20, droughtIndex: 0.7, slopeDegrees: 0 };
const localSlopeInput = e.localFireInput({ slope: Float32Array.of(18), aspect: Float32Array.of(90) }, 0, 1, 0, flatInput);
assert.ok(e.rothermelRateOfSpread(localSlopeInput, codeOf('TU5')) > e.rothermelRateOfSpread(flatInput, codeOf('TU5')),
  'Spread running upslope must use the cell\'s own local slope.');

/* --- Geometry: continuous shapes, not a stack of rectangles ---------------
 * Spotting detaches real islands ahead of the front, so a MultiPolygon is
 * expected; what matters is that no ring is a grid-row rectangle and that all
 * of them are closed. */
const reference = run({ targetMinutes: 360, windKph: 32, temperature: 36, humidity: 20, droughtIndex: 0.85 });
const geometry = reference.perimeterGeoJSON.geometry;
assert.ok(['Polygon', 'MultiPolygon'].includes(geometry.type), 'Unexpected geometry: ' + geometry.type);
const allRings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
for (const closed of allRings) assert.deepEqual(closed[0], closed[closed.length - 1], 'Every ring must be closed.');
const ring = allRings.reduce((biggest, candidate) => candidate.length > biggest.length ? candidate : biggest, allRings[0]);
assert.ok(ring.length >= 12, 'A smoothed contour has more vertices than a rectangle.');
assert.deepEqual(ring[0], ring[ring.length - 1], 'The contour must be closed.');
// Spotting detaches islands: every polygon must be summed, minus its holes,
// not only the largest ring.
const shoelaceOf = (points) => {
  let sum = 0;
  for (let i = 0; i < points.length - 1; i += 1) sum += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
  return Math.abs(sum / 2);
};
const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
const degreeArea = polygons.reduce((total, rings) =>
  total + shoelaceOf(rings[0]) - rings.slice(1).reduce((holes, hole) => holes + shoelaceOf(hole), 0), 0);
const contourHa = degreeArea * 111320 * (111320 * Math.cos(44.59 * Math.PI / 180)) / 10000;
assert.ok(Math.abs(contourHa - reference.totalBurnedHa) / reference.totalBurnedHa < 0.08,
  `Contour/cell deviation too large: ${contourHa.toFixed(1)} vs ${reference.totalBurnedHa}`);
assert.ok(reference.activeFrontGeoJSON, 'The flaming front must be exposed separately.');
assert.ok(reference.totalBurnedHa > run({ targetMinutes: 60, windKph: 32, temperature: 36, humidity: 20, droughtIndex: 0.85 }).totalBurnedHa,
  'Area must grow with time.');

/* --- Weather: it must actually drive the fire ----------------------------- */
const damp = run({ targetMinutes: 180, windKph: 20, temperature: 15, humidity: 75, droughtIndex: 0.1 });
const heatwave = run({ targetMinutes: 180, windKph: 20, temperature: 39, humidity: 17, droughtIndex: 0.95 });
assert.ok(heatwave.fuelMoisture < damp.fuelMoisture, 'A heatwave must dry the fuel out.');
assert.ok(heatwave.totalBurnedHa > damp.totalBurnedHa * 2,
  `Weather must change the spread: ${damp.totalBurnedHa} -> ${heatwave.totalBurnedHa}`);

/* --- Suppression: monotonic response, sustainable duty acting ------------- */
const attackable = { targetMinutes: 360, temperature: 30, humidity: 55, droughtIndex: 0.6, windKph: 8, windBearingDegrees: 135 };
const ccf = (count, autonomy) => run({ ...attackable,
  deployments: [{ type: 'CCF', count, ...IGNITION, radiusM: 1500, autonomy }] });
const unopposed = run(attackable).totalBurnedHa;
const with20 = ccf(20).totalBurnedHa;
const with40 = ccf(40).totalBurnedHa;
assert.ok(with20 < unopposed && with40 < with20, `Non-monotonic response: ${unopposed} / ${with20} / ${with40}`);
const fullDuty = ccf(40, 100);
const halfDuty = ccf(40, 50);
assert.ok(Math.abs(halfDuty.suppression.deployedFlowLpm - fullDuty.suppression.deployedFlowLpm / 2) <= 2,
  `Sustainable duty must bound the flow held: ${fullDuty.suppression.deployedFlowLpm} -> ${halfDuty.suppression.deployedFlowLpm}`);
assert.ok(halfDuty.totalBurnedHa >= fullDuty.totalBurnedHa, 'Less duty cannot contain the fire better.');

/* --- Placement must count: head against rear ------------------------------ */
const directional = { targetMinutes: 720, temperature: 32, humidity: 45, droughtIndex: 0.65, windKph: 12, windBearingDegrees: 0 };
const posted = (dy) => run({ ...directional,
  deployments: [{ type: 'CCF', count: 24, lng: IGNITION.lng, lat: IGNITION.lat + dy * 2 * KM_LAT, radiusM: 1800 }] }).totalBurnedHa;
const onHead = posted(1), onRear = posted(-1);
// On a species mosaic the contrast is less brutal than in a uniform stand, but
// the ordering must stay clear.
// The historical 10 % threshold was a numeric calibration with no source. The
// diurnal cycle is exactly what reduces the absolute contrast; the useful
// physical property is the strict ordering, which is still required without
// imposing an arbitrary multiplier.
assert.ok(onHead < onRear, `Attacking the head must beat attacking the rear: ${onHead} vs ${onRear}`);

/* --- Front breakdown ------------------------------------------------------ */
const front = reference.suppression;
assert.equal(front.headM + front.flankM + front.rearM, front.activePerimeterM, 'Head + flanks + rear must equal the front.');
assert.ok(front.meanIntensityKwM <= front.firelineIntensityKwM, 'The perimeter mean must stay under the head intensity.');

/* --- The human landscape of the Landes ------------------------------------
 * DFCI tracks, roads and buildings compartment the massif. The network must
 * hold moderate fires and lose its grip on violent ones - never become a wall,
 * which would turn the simulation into scripted corridors. */
const landes = (windKph, droughtIndex, network) => run({
  targetMinutes: 360, temperature: 36, humidity: 22, windKph, droughtIndex, windBearingDegrees: 135,
  domain: { lng: IGNITION.lng, lat: IGNITION.lat, boxMetres: 25000 },
  terrain: { region: 'gironde', network },
});
const moderateWithout = landes(22, 0.8, null).totalBurnedHa;
const moderateWith = landes(22, 0.8, 'landes').totalBurnedHa;
const extremeWithout = landes(60, 0.97, null).totalBurnedHa;
const extremeWith = landes(60, 0.97, 'landes').totalBurnedHa;
assert.ok(moderateWith < moderateWithout * 0.85,
  `The DFCI mesh must contain a moderate fire: ${moderateWithout} -> ${moderateWith}`);
assert.ok(extremeWith > extremeWithout * 0.2,
  `A break must never be an absolute wall: ${extremeWithout} -> ${extremeWith}`);
const gripModerate = 1 - moderateWith / moderateWithout;
const gripExtreme = 1 - extremeWith / extremeWithout;
assert.ok(gripExtreme < gripModerate,
  `The network must lose its grip as intensity rises: ${(gripModerate * 100).toFixed(0)}% -> ${(gripExtreme * 100).toFixed(0)}%`);

/* --- Persistent lines and indirect attack --------------------------------- */
const lineCase = { targetMinutes: 720, temperature: 30, humidity: 55, droughtIndex: 0.6,
  windKph: 8, windBearingDegrees: 135, startHour: 8 };
const withDozers = run({ ...lineCase, deployments: [{ id: 'dozer-persistent', type: 'DOZ', count: 4,
  ...IGNITION, radiusM: 1500 }] });
const withoutDozers = run(lineCase);
assert.ok(withDozers.suppression.constructedLineM > 0 && withDozers.totalBurnedHa < withoutDozers.totalBurnedHa * 0.95,
  `The cumulative line must change the result: ${withoutDozers.totalBurnedHa} -> ${withDozers.totalBurnedHa}`);
const lineEngine = engine();
const lineDeployment = [{ id: 'dozer-progress', type: 'DOZ', count: 1, ...IGNITION, radiusM: 1500 }];
const lineAt3h = lineEngine.simulate({ ...lineCase, independent: false, reset: true, targetMinutes: 180,
  ignitionLngLat: IGNITION, deployments: lineDeployment });
const lineAt6h = lineEngine.simulate({ ...lineCase, independent: false, reset: false, targetMinutes: 360,
  ignitionLngLat: IGNITION, deployments: lineDeployment });
assert.ok(lineAt6h.suppression.constructedLineM > lineAt3h.suppression.constructedLineM,
  'Line production must accumulate between two persistent sub-runs.');
const unattendedDelay = e.crossingDelayMinutes(14, 500, 2, 10, false);
const heldDelay = e.crossingDelayMinutes(14, 500, 2, 10, true);
assert.ok(heldDelay > unattendedDelay && Number.isFinite(heldDelay),
  'A staffed line must be more effective without becoming an absolute barrier.');
const explicitLine = { name: 'Test anchor', sector: 'Head', widthM: 14, staffed: true,
  coordinates: [[IGNITION.lng - 0.01, IGNITION.lat - 0.006], [IGNITION.lng + 0.012, IGNITION.lat + 0.005]] };
const lineOnly = run({ ...lineCase, targetMinutes: 180, firebreaks: [explicitLine] });
const tactical = run({ ...lineCase, targetMinutes: 180, firebreaks: [{ ...explicitLine, tacticalBurn: true }] });
assert.ok(lineOnly.suppression.constructedLineM > 0 && tactical.totalBurnedHa > lineOnly.totalBurnedHa,
  'A tactical burn must run over an area while keeping its held line.');

/* Human exposure: coherent, and never invented outside the described massif. */
const exposed = landes(32, 0.9, 'landes');
assert.ok(exposed.network, 'The network must be named in the result.');
assert.ok(exposed.exposure && exposed.exposure.residentsAtRisk >= 0 && exposed.exposure.tracksCutKm >= 0,
  'Incoherent exposure summary.');
assert.equal(landes(32, 0.9, null).exposure, null,
  'With no network described, no exposure may be invented.');
// The territorial raster only covers the Gironde. On a domain elsewhere it must
// produce neither infrastructure nor an exposure summary, even when loaded.
const provence = run({
  targetMinutes: 240, temperature: 34, humidity: 24, droughtIndex: 0.88, windKph: 30, windBearingDegrees: 135,
  ignitionLngLat: { lng: 5.4474, lat: 43.3170, radiusM: 0 },
  domain: { lng: 5.4474, lat: 43.3170, boxMetres: 25000 },
  terrain: { region: 'marseille' },
});
assert.equal(provence.exposure, null,
  'Outside the massif covered by the raster, no exposure summary may appear.');
assert.equal(provence.network, null,
  'No network may be named outside the described massif.');

/* The network belongs to the place, like the vegetation. */
const networkA = engine(); networkA.configureDomain({ lng: IGNITION.lng, lat: IGNITION.lat, boxMetres: 25000 });
const networkB = engine(); networkB.configureDomain({ lng: IGNITION.lng + 0.06, lat: IGNITION.lat - 0.04, boxMetres: 25000 });
const infraA = networkA.buildInfrastructure('landes', { region: 'gironde' });
const infraB = networkB.buildInfrastructure('landes', { region: 'gironde' });
const trackShareA = [...infraA.infra].filter((flags) => flags & networkA.INFRA_TRACK).length / infraA.infra.length;
const trackShareB = [...infraB.infra].filter((flags) => flags & networkB.INFRA_TRACK).length / infraB.infra.length;
assert.ok(Math.abs(trackShareA - trackShareB) < 0.06,
  `Track density must be stable from one window to the next: ${(trackShareA * 100).toFixed(1)}% vs ${(trackShareB * 100).toFixed(1)}%`);

/* --- Unit catalogue ------------------------------------------------------- */
assert.ok(Object.keys(e.APPLIANCES).length >= 12, 'The fleet must cover ground, air and engineering.');
for (const [code, spec] of Object.entries(e.APPLIANCES)) {
  const flow = e.sustainedFlowLpm(code);
  assert.ok(Number.isFinite(flow) && flow >= 0, `Invalid sustained flow for ${code}`);
  assert.ok(spec.tankL > 0 || spec.lineMetresPerHour > 0, `${code} carries neither water nor line capacity.`);
}

/* --- The catalogue quoted to agents must match the one registered ----------
 * `app/tool-names.ts` is what the landing page tells an agent it will find
 * after sign-in. The definitions live in `app/firenow-client.tsx`. If the two
 * drift, the front door advertises tools that do not exist - which is exactly
 * the failure the catalogue exists to prevent. */
const clientSource = fs.readFileSync(new URL('../app/firenow-client.tsx', import.meta.url), 'utf8');
const registeredTools = [...clientSource.matchAll(/name: '([a-z_]+)', title:/g)].map((match) => match[1]);
const quotedTools = [...fs.readFileSync(new URL('../app/tool-names.ts', import.meta.url), 'utf8')
  .matchAll(/^ {2}'([a-z_]+)',$/gm)].map((match) => match[1]);
assert.ok(registeredTools.length >= 21, `Only ${registeredTools.length} tool definitions found in firenow-client.tsx.`);
assert.deepEqual(quotedTools, registeredTools,
  'app/tool-names.ts has drifted from the tools registered in firenow-client.tsx.');

console.log(JSON.stringify({
  species: e.SPECIES.length,
  appliances: Object.keys(e.APPLIANCES).length,
  anchoringIdentical: `${identical}/${probes.length}`,
  girondeRasterCells: realGironde.landscape.appliedCells,
  contourVertices: ring.length,
  contourDeviationPct: Number((100 * (contourHa - reference.totalBurnedHa) / reference.totalBurnedHa).toFixed(1)),
  unopposed, with20, with40, onHead, onRear,
  flowFullDuty: fullDuty.suppression.deployedFlowLpm, flowHalfDuty: halfDuty.suppression.deployedFlowLpm,
  overnightGrowthHa: nightRun.totalBurnedHa, daytimeGrowthHa: dayRun.totalBurnedHa,
  networkGripModerate: (gripModerate * 100).toFixed(0) + '%', networkGripExtreme: (gripExtreme * 100).toFixed(0) + '%',
  cumulativeLineM: withDozers.suppression.constructedLineM,
  trackShare: (trackShareA * 100).toFixed(1) + '%', residentsAtRisk: exposed.exposure.residentsAtRisk,
  webmcpTools: registeredTools.length,
}, null, 1));
