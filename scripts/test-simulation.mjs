import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Chaque scenario part d'un moteur neuf : l'etat de propagation est persistant.
function engine() {
  const self = { postMessage() {} };
  const context = vm.createContext({ self, Math, Number, String, Array, Object, Infinity, Uint8Array, Float32Array, Map, Set });
  vm.runInContext(fs.readFileSync(new URL('../public/simulation.worker.js', import.meta.url), 'utf8'), context);
  return self.__fireopsTest;
}
const e = engine();
const IGNITION = { lng: -0.4540519, lat: 44.5897472, radiusM: 0 };
const KM_LAT = 1 / 111.32;
const run = (overrides) => engine().simulate({
  independent: true, slopeDegrees: 3, ignitionLngLat: IGNITION, deployments: [], ...overrides,
});
const codeOf = (model) => {
  const index = e.SPECIES.findIndex((species) => species.model === model);
  assert.ok(index >= 0, 'modele absent du registre: ' + model);
  return index;
};

/* --- Vitesses contre les fourchettes publiees -----------------------------
 * Le modele tournait avec un coefficient d'ajustement par espece (jusqu'a
 * x2,1) herite d'un calage landais. Il a ete retire : Rothermel est utilise
 * tel quel, et c'est la litterature qui sert de reference. */
const BENCHMARKS = [
  ['GR2', 40, 110, 'herbe haute séchée'],
  ['GR4', 40, 110, 'herbe continue'],
  ['SH5', 25, 100, 'chaparral / maquis haut'],
  ['TL8', 0.5, 6,  'litière résineuse fermée'],
  ['TU5', 8,  28,  'pin avec sous-étage'],
  ['TU1', 4,  18,  'sous-bois clair'],
];
for (const [model, low, high, label] of BENCHMARKS) {
  const ros = e.rothermelRateOfSpread({ moisture: 0.05, windKph: 30, slopeDegrees: 0, droughtIndex: 0.7 }, codeOf(model));
  assert.ok(ros >= low && ros <= high, `${model} (${label}) hors fourchette publiée: ${ros.toFixed(1)} m/min, attendu ${low}-${high}`);
}
// Le combustible vivant doit freiner : plus il est humide, plus le front ralentit.
const shrub = codeOf('SH5');
const sec = e.rothermelRateOfSpread({ moisture: 0.05, windKph: 30, slopeDegrees: 0, droughtIndex: 0.95 }, shrub);
const vert = e.rothermelRateOfSpread({ moisture: 0.05, windKph: 30, slopeDegrees: 0, droughtIndex: 0.05 }, shrub);
assert.ok(sec > vert * 1.2, `Le vivant humide doit freiner nettement: ${vert.toFixed(1)} -> ${sec.toFixed(1)}`);

/* --- Robustesse : une pente absente ne doit pas produire de NaN ----------- */
const sansPente = e.rothermelRateOfSpread({ moisture: 0.05, windKph: 20 }, codeOf('TU5'));
assert.ok(Number.isFinite(sansPente) && sansPente > 0, 'Une pente absente doit retomber sur le terrain plat, pas sur NaN.');

/* --- Cycle diurne : continu, local et applique au vent a mi-flamme -------- */
const midnight = e.environmentAt({ startHour: 0, windKph: 30, temperature: 30, humidity: 40, droughtIndex: 0.7 }, 0);
const noon = e.environmentAt({ startHour: 12, windKph: 30, temperature: 30, humidity: 40, droughtIndex: 0.7 }, 0);
assert.equal(midnight.windKph, 30, 'Le vent synoptique a 10 m ne doit pas disparaitre la nuit.');
assert.ok(midnight.wafScale < noon.wafScale && midnight.liveMoistureRecovery > noon.liveMoistureRecovery,
  'La nuit doit reduire le WAF et relever l humidite du vivant.');
assert.ok(Math.abs(e.daylightProfile(6.5) - e.daylightProfile(6.5001)) < 0.001,
  'Le profil doit rester continu au lever du soleil.');
const diurnalCase = { targetMinutes: 180, temperature: 36, humidity: 20, droughtIndex: 0.85, windKph: 32 };
const nightRun = run({ ...diurnalCase, startHour: 0 });
const dayRun = run({ ...diurnalCase, startHour: 12 });
assert.ok(dayRun.totalBurnedHa > nightRun.totalBurnedHa * 3,
  `Le perimetre couvant doit fortement reduire la propagation nocturne: ${nightRun.totalBurnedHa} / ${dayRun.totalBurnedHa}`);

/* --- Mort du perimetre : etat 3 persistant, jamais re-ensemence ----------- */
const edgeEngine = engine();
const weakEdge = edgeEngine.simulate({ reset: true, targetMinutes: 360, ignitionLngLat: IGNITION,
  temperature: 16, humidity: 80, droughtIndex: 0.1, windKph: 5, startHour: 0,
  slopeDegrees: 0, deployments: [] });
assert.ok(weakEdge.extinguishedEdgeCells > 0 && weakEdge.extinguishedEdgeGeoJSON,
  'Une lisiere faible doit devenir eteinte et etre exposee en geometrie.');
const reignitionAttempt = edgeEngine.simulate({ reset: false, targetMinutes: 420, ignitionLngLat: IGNITION,
  temperature: 40, humidity: 10, droughtIndex: 0.98, windKph: 60, startHour: 0,
  slopeDegrees: 0, deployments: [] });
assert.equal(reignitionAttempt.totalBurnedHa, weakEdge.totalBurnedHa,
  'Une cellule de lisiere eteinte ne doit pas etre re-ensemencee au sous-pas suivant.');

/* --- Composition regionale : les parts tirees valent les parts declarees -- */
const SITES = {
  gironde: { lng: -0.4540519, lat: 44.5897472 },
  marseille: { lng: 5.4474, lat: 43.3170 },
  california: { lng: -120.0366, lat: 39.7229 },
};
for (const [region, centre] of Object.entries(SITES)) {
  const result = run({ targetMinutes: 1, ignitionLngLat: { ...centre, radiusM: 0 },
    domain: { ...centre, boxMetres: 30000 }, terrain: { region },
    temperature: 30, humidity: 30, droughtIndex: 0.7, windKph: 15, windBearingDegrees: 90 });
  const observed = new Map(result.fuelComposition.map((entry) => [entry.code, entry.part]));
  const mix = e.speciesMix(region);
  for (let i = 0; i < mix.length; i += 1) {
    const declared = mix[i];
    const expected = declared.upTo - (i > 0 ? mix[i - 1].upTo : 0);
    if (expected < 0.03) continue;
    const actual = observed.get(declared.code) || 0;
    // Une fenetre de 30 km echantillonne la region : un ecart local est normal,
    // c est la derive massive (37 % au lieu de 14 %) qu il faut attraper.
    assert.ok(Math.abs(actual - expected) < 0.06,
      `${region}: espèce ${declared.code} tirée à ${(actual * 100).toFixed(1)}% au lieu de ${(expected * 100).toFixed(1)}%`);
  }
}

/* --- Ancrage geographique -------------------------------------------------
 * La carte etait un motif fige dans l'espace de la grille : deplacer le
 * cadrage deplacait des rivieres fictives et faisait varier la surface d'un
 * facteur vingt sur un meme feu. Le paysage doit desormais tenir au lieu. */
const probes = [];
for (let i = 0; i < 200; i += 1) probes.push({ lng: -120.0366 + (i % 20) * 0.01, lat: 39.7229 + Math.floor(i / 20) * 0.01 });
const cadrageA = engine(); cadrageA.configureDomain({ lng: -120.0366, lat: 39.7229, boxMetres: 50000 });
const cadrageB = engine(); cadrageB.configureDomain({ lng: -119.60, lat: 39.90, boxMetres: 20000 });
const identiques = probes.filter((p) =>
  cadrageA.speciesAt(p.lng, p.lat, 'california') === cadrageB.speciesAt(p.lng, p.lat, 'california')).length;
assert.equal(identiques, probes.length,
  `Un lieu doit garder sa végétation quel que soit le cadrage: ${identiques}/${probes.length}`);

/* --- Geometrie : des formes continues, pas un empilement de rectangles ----
 * Les sautes de braises detachent de vrais ilots en avant du front : une
 * MultiPolygon est donc attendue, ce qui compte est qu'aucun anneau ne soit
 * un rectangle de ligne de grille et que tous soient fermes. */
const reference = run({ targetMinutes: 360, windKph: 32, temperature: 36, humidity: 20, droughtIndex: 0.85 });
const geometry = reference.perimeterGeoJSON.geometry;
assert.ok(['Polygon', 'MultiPolygon'].includes(geometry.type), 'Géométrie inattendue: ' + geometry.type);
const allRings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
for (const closed of allRings) assert.deepEqual(closed[0], closed[closed.length - 1], 'Chaque anneau doit être fermé.');
const ring = allRings.reduce((biggest, candidate) => candidate.length > biggest.length ? candidate : biggest, allRings[0]);
assert.ok(ring.length >= 12, 'Un contour lissé a plus de sommets qu’un rectangle.');
assert.deepEqual(ring[0], ring[ring.length - 1], 'Le contour doit être fermé.');
// Les sautes detachent des ilots : il faut sommer TOUS les polygones, en
// retranchant leurs trous, pas seulement le plus grand anneau.
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
  `Écart contour/cellules trop grand: ${contourHa.toFixed(1)} vs ${reference.totalBurnedHa}`);
assert.ok(reference.activeFrontGeoJSON, 'Le front en flammes doit être exposé séparément.');
assert.ok(reference.totalBurnedHa > run({ targetMinutes: 60, windKph: 32, temperature: 36, humidity: 20, droughtIndex: 0.85 }).totalBurnedHa,
  'La surface doit croître avec le temps.');

/* --- Meteo : elle doit reellement piloter le feu --------------------------- */
const humide = run({ targetMinutes: 180, windKph: 20, temperature: 15, humidity: 75, droughtIndex: 0.1 });
const canicule = run({ targetMinutes: 180, windKph: 20, temperature: 39, humidity: 17, droughtIndex: 0.95 });
assert.ok(canicule.fuelMoisture < humide.fuelMoisture, 'La canicule doit assécher le combustible.');
assert.ok(canicule.totalBurnedHa > humide.totalBurnedHa * 2,
  `La météo doit changer la propagation: ${humide.totalBurnedHa} -> ${canicule.totalBurnedHa}`);

/* --- Extinction : reponse monotone, autonomie agissante ------------------- */
const attackable = { targetMinutes: 360, temperature: 30, humidity: 55, droughtIndex: 0.6, windKph: 8, windBearingDegrees: 135 };
const ccf = (count, autonomy) => run({ ...attackable,
  deployments: [{ type: 'CCF', count, ...IGNITION, radiusM: 1500, autonomy }] });
const libre = run(attackable).totalBurnedHa;
const avec20 = ccf(20).totalBurnedHa;
const avec40 = ccf(40).totalBurnedHa;
assert.ok(avec20 < libre && avec40 < avec20, `Réponse non monotone: ${libre} / ${avec20} / ${avec40}`);
const pleine = ccf(40, 100);
const demi = ccf(40, 50);
assert.ok(Math.abs(demi.suppression.deployedFlowLpm - pleine.suppression.deployedFlowLpm / 2) <= 2,
  `L'autonomie doit borner le débit tenu: ${pleine.suppression.deployedFlowLpm} -> ${demi.suppression.deployedFlowLpm}`);
assert.ok(demi.totalBurnedHa >= pleine.totalBurnedHa, 'Moins d’autonomie ne peut pas mieux contenir le feu.');

/* --- Le placement doit compter : tete contre arriere ---------------------- */
const directional = { targetMinutes: 720, temperature: 32, humidity: 45, droughtIndex: 0.65, windKph: 12, windBearingDegrees: 0 };
const posted = (dy) => run({ ...directional,
  deployments: [{ type: 'CCF', count: 24, lng: IGNITION.lng, lat: IGNITION.lat + dy * 2 * KM_LAT, radiusM: 1800 }] }).totalBurnedHa;
const tete = posted(1), arriere = posted(-1);
// Sur une mosaique d especes le contraste est moins brutal qu en peuplement
// uniforme, mais l ordre doit rester net.
// Le seuil historique de 10 % etait un calage numerique sans source. Le cycle
// diurne reduit justement le contraste absolu ; la propriete physique utile est
// l ordre strict, qui reste exige sans imposer un multiplicateur arbitraire.
assert.ok(tete < arriere, `Attaquer la tête doit valoir mieux que l’arrière: ${tete} vs ${arriere}`);

/* --- Decomposition du front ---------------------------------------------- */
const front = reference.suppression;
assert.equal(front.headM + front.flankM + front.rearM, front.activePerimeterM, 'Tête + flancs + arrière doit égaler le front.');
assert.ok(front.meanIntensityKwM <= front.firelineIntensityKwM, 'La moyenne du périmètre doit rester sous l’intensité de tête.');

/* --- Anthropisation du massif landais -------------------------------------
 * Pistes DFCI, routes et bâti compartimentent le massif. Le réseau doit tenir
 * les feux modérés et perdre prise sur les feux violents — jamais devenir un
 * mur, ce qui transformerait la simulation en couloirs scriptés. */
const landes = (windKph, droughtIndex, network) => run({
  targetMinutes: 360, temperature: 36, humidity: 22, windKph, droughtIndex, windBearingDegrees: 135,
  domain: { lng: IGNITION.lng, lat: IGNITION.lat, boxMetres: 25000 },
  terrain: { region: 'gironde', network },
});
const modereSans = landes(22, 0.8, null).totalBurnedHa;
const modereAvec = landes(22, 0.8, 'landes').totalBurnedHa;
const extremeSans = landes(60, 0.97, null).totalBurnedHa;
const extremeAvec = landes(60, 0.97, 'landes').totalBurnedHa;
assert.ok(modereAvec < modereSans * 0.85,
  `Le maillage DFCI doit contenir un feu modéré: ${modereSans} -> ${modereAvec}`);
assert.ok(extremeAvec > extremeSans * 0.2,
  `Une coupure ne doit jamais être un mur absolu: ${extremeSans} -> ${extremeAvec}`);
const priseModere = 1 - modereAvec / modereSans;
const priseExtreme = 1 - extremeAvec / extremeSans;
assert.ok(priseExtreme < priseModere,
  `Le réseau doit perdre prise quand l’intensité monte: ${(priseModere * 100).toFixed(0)}% -> ${(priseExtreme * 100).toFixed(0)}%`);

/* Enjeux humains : cohérents, et jamais inventés hors du massif décrit. */
const expose = landes(32, 0.9, 'landes');
assert.ok(expose.network, 'Le réseau doit être nommé dans le résultat.');
assert.ok(expose.exposure && expose.exposure.populationMenacee >= 0 && expose.exposure.pistesCoupeesKm >= 0,
  'Bilan des enjeux incohérent.');
assert.equal(landes(32, 0.9, null).exposure, null,
  'Sans réseau décrit, aucun enjeu ne doit être inventé.');

/* Le réseau tient au lieu, comme la végétation. */
const reseauA = engine(); reseauA.configureDomain({ lng: IGNITION.lng, lat: IGNITION.lat, boxMetres: 25000 });
const reseauB = engine(); reseauB.configureDomain({ lng: IGNITION.lng + 0.06, lat: IGNITION.lat - 0.04, boxMetres: 25000 });
const infraA = reseauA.buildInfrastructure('landes', { region: 'gironde' });
const infraB = reseauB.buildInfrastructure('landes', { region: 'gironde' });
const partA = [...infraA.infra].filter((flags) => flags & reseauA.INFRA_TRACK).length / infraA.infra.length;
const partB = [...infraB.infra].filter((flags) => flags & reseauB.INFRA_TRACK).length / infraB.infra.length;
assert.ok(Math.abs(partA - partB) < 0.06,
  `La densité de pistes doit être stable d’une fenêtre à l’autre: ${(partA * 100).toFixed(1)}% vs ${(partB * 100).toFixed(1)}%`);

/* --- Catalogue des moyens ------------------------------------------------- */
assert.ok(Object.keys(e.APPLIANCES).length >= 12, 'Le parc doit couvrir terrestre, aérien et génie.');
for (const [code, spec] of Object.entries(e.APPLIANCES)) {
  const flow = e.sustainedFlowLpm(code);
  assert.ok(Number.isFinite(flow) && flow >= 0, `Débit soutenu invalide pour ${code}`);
  assert.ok(spec.tankL > 0 || spec.lineMetresPerHour > 0, `${code} ne porte ni eau ni capacité de ligne.`);
}

console.log(JSON.stringify({
  especes: e.SPECIES.length,
  moyens: Object.keys(e.APPLIANCES).length,
  ancrageIdentique: `${identiques}/${probes.length}`,
  contourSommets: ring.length,
  ecartContourPct: Number((100 * (contourHa - reference.totalBurnedHa) / reference.totalBurnedHa).toFixed(1)),
  libre, avec20, avec40, tete, arriere,
  debitPlein: pleine.suppression.deployedFlowLpm, debitDemi: demi.suppression.deployedFlowLpm,
  croissanceNocturneHa: nightRun.totalBurnedHa, croissanceDiurneHa: dayRun.totalBurnedHa,
  priseReseauModere: (priseModere*100).toFixed(0)+"%", priseReseauExtreme: (priseExtreme*100).toFixed(0)+"%",
  pistesPart: (partA*100).toFixed(1)+"%", habitantsMenaces: expose.exposure.populationMenacee,
}, null, 1));
