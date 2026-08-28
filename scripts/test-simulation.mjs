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
const IGNITION = { lng: -0.4540519, lat: 44.5897472, radiusM: 0 };
const KM_LAT = 1 / 111.32;
const run = (overrides) => engine().simulate({
  independent: true, slopeDegrees: 3, ignitionLngLat: IGNITION, deployments: [], ...overrides,
});

/* --- Propagation ---------------------------------------------------------- */
const reference = run({ targetMinutes: 360, moisture: 0.08, windKph: 32, windDirection: 'Nord-ouest' });
assert.equal(engine().GRID_SIZE, 128);
assert.ok(reference.rateOfSpreadMetersPerMinute >= 15 && reference.rateOfSpreadMetersPerMinute <= 35,
  `ROS a 32 km/h hors plage: ${reference.rateOfSpreadMetersPerMinute}`);
assert.ok(reference.totalBurnedHa > run({ targetMinutes: 60, moisture: 0.08, windKph: 32 }).totalBurnedHa,
  'La surface doit croitre avec le temps.');

/* --- Geometrie : une seule forme fermee, pas un empilement de rectangles --- */
const geometry = reference.perimeterGeoJSON.geometry;
assert.equal(geometry.type, 'Polygon', 'Un feu connexe doit produire un seul polygone.');
const ring = geometry.coordinates[0];
assert.deepEqual(ring[0], ring[ring.length - 1], 'Le contour doit etre ferme.');
assert.ok(ring.length >= 12, 'Un contour lisse doit avoir plus de sommets qu un rectangle.');
// L'aire du contour doit correspondre a celle des cellules brulees.
let shoelace = 0;
for (let i = 0; i < ring.length - 1; i += 1) shoelace += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
const contourHa = Math.abs(shoelace / 2) * 111320 * (111320 * Math.cos(44.59 * Math.PI / 180)) / 10000;
assert.ok(Math.abs(contourHa - reference.totalBurnedHa) / reference.totalBurnedHa < 0.06,
  `Ecart contour/cellules trop grand: ${contourHa.toFixed(1)} vs ${reference.totalBurnedHa}`);
assert.ok(reference.activeFrontGeoJSON, 'Le front en flammes doit etre expose separement.');

/* --- Meteo : elle doit reellement piloter le feu --------------------------- */
const humide = run({ targetMinutes: 180, windKph: 20, temperature: 15, humidity: 75, droughtIndex: 0.1 });
const canicule = run({ targetMinutes: 180, windKph: 20, temperature: 39, humidity: 17, droughtIndex: 0.95 });
assert.ok(canicule.fuelMoisture < humide.fuelMoisture, 'La canicule doit assecher le combustible.');
assert.ok(canicule.totalBurnedHa > humide.totalBurnedHa * 2,
  `La meteo doit changer la propagation: ${humide.totalBurnedHa} -> ${canicule.totalBurnedHa}`);

/* --- Extinction : reponse monotone au nombre d engins ---------------------- */
const attackable = { targetMinutes: 360, temperature: 30, humidity: 55, droughtIndex: 0.6, windKph: 8, windBearingDegrees: 135 };
const ccf = (count) => run({ ...attackable, deployments: [{ type: 'CCF', count, ...IGNITION, radiusM: 1500 }] }).totalBurnedHa;
const [libre, avec20, avec40] = [run(attackable).totalBurnedHa, ccf(20), ccf(40)];
assert.ok(avec20 < libre && avec40 < avec20, `Reponse non monotone: ${libre} / ${avec20} / ${avec40}`);
const contenu = run({ ...attackable, deployments: [{ type: 'CCF', count: 40, ...IGNITION, radiusM: 1500 }] });
assert.equal(contenu.suppression.status, 'maitrise', 'Un debit superieur au besoin doit donner la maitrise.');
assert.ok(contenu.suppression.containmentMinutes > 0, 'La maitrise doit avoir un delai chiffre.');

/* --- Le placement doit compter : tete contre arriere ---------------------- */
const directional = { targetMinutes: 720, temperature: 32, humidity: 45, droughtIndex: 0.65, windKph: 12, windBearingDegrees: 0 };
const posted = (dy) => run({ ...directional, deployments: [{ type: 'CCF', count: 24, lng: IGNITION.lng, lat: IGNITION.lat + dy * 2 * KM_LAT, radiusM: 1800 }] }).totalBurnedHa;
const [tete, arriere] = [posted(1), posted(-1)];
assert.ok(tete < arriere * 0.5, `Attaquer la tete doit valoir bien mieux que l arriere: ${tete} vs ${arriere}`);

/* --- Intensite extreme : aucun debit ne suffit ---------------------------- */
const extreme = run({ targetMinutes: 360, temperature: 40, humidity: 15, droughtIndex: 0.98, windKph: 45, windBearingDegrees: 135,
  deployments: [{ type: 'CCF', count: 50, ...IGNITION, radiusM: 2000 }] });
assert.equal(extreme.suppression.attackMode, 'indirect', 'Au-dela de 4 000 kW/m l attaque directe est inoperante.');
assert.equal(extreme.suppression.containmentMinutes, null, 'Un feu inattaquable ne doit pas afficher de delai de maitrise.');

/* --- Decomposition du front ---------------------------------------------- */
const front = reference.suppression;
assert.equal(front.headM + front.flankM + front.rearM, front.activePerimeterM, 'Tete + flancs + arriere doit egaler le front.');
assert.ok(front.meanIntensityKwM < front.firelineIntensityKwM, 'La moyenne du perimetre doit rester sous l intensite de tete.');

console.log(JSON.stringify({
  ros32: reference.rateOfSpreadMetersPerMinute,
  contourSommets: ring.length,
  ecartContourPct: Number((100 * (contourHa - reference.totalBurnedHa) / reference.totalBurnedHa).toFixed(1)),
  eauHumide: humide.fuelMoisture, eauCanicule: canicule.fuelMoisture,
  libre, avec20, avec40, tete, arriere,
  maitriseMin: contenu.suppression.containmentMinutes,
  grid: `${engine().GRID_SIZE}x${engine().GRID_SIZE}`,
}, null, 1));
