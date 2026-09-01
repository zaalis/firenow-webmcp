/* FireNow local wildfire engine: Rothermel (1972), Alexander (1985), 128 x 128 cellular grid. */
const GRID_SIZE = 128;
// Nombre maximal de foyers secondaires acceptes en plus du foyer principal.
const MAX_EXTRA_IGNITIONS = 16;
/* Le domaine etait fige sur Landiras en 25 km. Un feu comme Saumos 2026
 * (47 000 ha) deborde largement cette boite : centre et emprise sont donc
 * desormais choisis par le scenario, la grille restant a 128 x 128. */
const DEFAULT_DOMAIN = { lng: -0.4540519, lat: 44.5897472, boxMetres: 25000 };
let BOX_METERS, CELL_METERS, IGNITION, BOUNDS;
function configureDomain(domain) {
  const centre = {
    lng: Number.isFinite(domain && domain.lng) ? domain.lng : DEFAULT_DOMAIN.lng,
    lat: Number.isFinite(domain && domain.lat) ? domain.lat : DEFAULT_DOMAIN.lat,
  };
  const box = Math.max(2000, Math.min(120000, Number(domain && domain.boxMetres) || DEFAULT_DOMAIN.boxMetres));
  BOX_METERS = box;
  CELL_METERS = box / GRID_SIZE;
  IGNITION = centre;
  const latDegrees = box / 111320;
  const lngDegrees = box / (111320 * Math.cos(centre.lat * Math.PI / 180));
  BOUNDS = { west: centre.lng - lngDegrees / 2, east: centre.lng + lngDegrees / 2, south: centre.lat - latDegrees / 2, north: centre.lat + latDegrees / 2 };
  return `${centre.lng},${centre.lat},${box}`;
}
let DOMAIN_KEY = configureDomain(DEFAULT_DOMAIN);
const MIDFLAME_FACTOR = 0.25; // vent a mi-flamme sous couvert de pin maritime
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const indexOf = (x, y) => y * GRID_SIZE + x;

/* Cycle diurne local.
 * - Andrews, USFS RMRS-GTR-266 (2012) : Rothermel doit recevoir le vent a
 *   mi-flamme, distinct du vent synoptique a 10/20 ft. La stabilite nocturne
 *   agit donc sur le WAF, jamais sur windKph.
 * - Bishop, FLAME / RMRS-P-46CD (2007) : une variation de l'humidite des
 *   combustibles vivants de l'ordre de 20 % est operationnellement
 *   significative ; c'est la recuperation maximale appliquee ici.
 * - Freeborn et al., RSE 268 (2022), doi:10.1016/j.rse.2021.112777 : la part
 *   nocturne observee varie de 3 % a 29 % selon la secheresse et la taille du
 *   feu. Le plancher de perimetre propagateur est fixe a 18 %, au milieu de
 *   cette plage publiee, et non ajuste sur un incendie particulier.
 */
const NIGHT_WAF_FLOOR = 0.35;
const NIGHT_ACTIVE_FRACTION = 0.18;
const LIVE_MOISTURE_RECOVERY = 0.20;
function localHourAt(input, minutes) {
  const start = Number.isFinite(input.startHour) ? input.startHour : 12;
  return ((start + minutes / 60) % 24 + 24) % 24;
}
function daylightProfile(hour, sunrise = 6.5, sunset = 21.5) {
  if (!(hour > sunrise && hour < sunset)) return 0;
  return Math.sin(Math.PI * (hour - sunrise) / (sunset - sunrise));
}
function interpolateHourly(series, minutes) {
  if (!Array.isArray(series) || !series.length) return null;
  const absoluteHour = minutes / 60;
  let before = series[0], after = series[series.length - 1];
  for (let i = 0; i < series.length; i += 1) {
    const at = Number.isFinite(series[i].hourFromStart) ? series[i].hourFromStart : i;
    if (at <= absoluteHour) before = series[i];
    if (at >= absoluteHour) { after = series[i]; break; }
  }
  const a = Number.isFinite(before.hourFromStart) ? before.hourFromStart : series.indexOf(before);
  const b = Number.isFinite(after.hourFromStart) ? after.hourFromStart : series.indexOf(after);
  const ratio = b > a ? clamp((absoluteHour - a) / (b - a), 0, 1) : 0;
  const value = {};
  for (const key of ['temperature','humidity','windKph','windBearingDegrees','droughtIndex']) {
    const av = Number(before[key]), bv = Number(after[key]);
    if (Number.isFinite(av) && Number.isFinite(bv)) value[key] = av + (bv - av) * ratio;
    else if (Number.isFinite(av)) value[key] = av;
  }
  return value;
}
function environmentAt(input, minutes) {
  const hourly = interpolateHourly(input.weatherSeries, minutes);
  const hour = localHourAt(input, minutes);
  const solar = daylightProfile(hour, Number(input.sunriseHour) || 6.5, Number(input.sunsetHour) || 21.5);
  const weather = { ...input, ...(hourly || {}) };
  weather.hourOfDay = hour;
  weather.daylightFactor = solar;
  weather.wafScale = NIGHT_WAF_FLOOR + (1 - NIGHT_WAF_FLOOR) * solar;
  weather.activeFraction = NIGHT_ACTIVE_FRACTION + (1 - NIGHT_ACTIVE_FRACTION) * solar;
  weather.moisture = deriveMoisture(weather);
  weather.liveMoistureRecovery = LIVE_MOISTURE_RECOVERY * (1 - solar);
  return weather;
}

function rothermelRateOfSpread(input, fuelCode = 0) {
  const fuel = FUEL[fuelCode] || FUEL[0];
  if (fuel.nonBurnable) return 0;
  const sigma = fuel.savr;
  const totalLoad = fuel.load + (fuel.liveLoad || 0);
  const beta = clamp(totalLoad / (fuel.depth * 32), 0.001, 0.12);
  const betaOpt = 3.348 * Math.pow(sigma, -0.8189);
  const ratio = beta / betaOpt;
  const exponentA = 133 * Math.pow(sigma, -0.7913);
  const gammaMax = Math.pow(sigma, 1.5) / (495 + 0.0594 * Math.pow(sigma, 1.5));
  const gamma = gammaMax * Math.pow(ratio, exponentA) * Math.exp(exponentA * (1 - ratio));
  const damping = (ratioValue) => {
    const r = clamp(ratioValue, 0, 1.5);
    return clamp(1 - 2.59 * r + 5.11 * r ** 2 - 3.52 * r ** 3, 0, 1);
  };
  const deadDamping = damping(input.moisture / fuel.moistureExtinction);
  // Teneur en eau du vegetal vivant : elle chute avec la secheresse cumulee.
  const baseLiveMoisture = clamp(1.20 - 0.75 * (Number(input.droughtIndex) || 0), 0.45, 1.20);
  const liveMoisture = clamp(baseLiveMoisture * (1 + (Number(input.liveMoistureRecovery) || 0)), 0.45, 1.44);
  const liveLoad = fuel.liveLoad || 0;
  let liveDamping = 0;
  if (liveLoad > 0) {
    // Rothermel 1972 : la teneur d'extinction du vivant depend de la sécheresse du mort.
    const w = fuel.load / liveLoad;
    const liveExtinction = Math.max(fuel.moistureExtinction, 2.9 * w * (1 - input.moisture / fuel.moistureExtinction) - 0.226);
    liveDamping = damping(liveMoisture / liveExtinction);
  }
  const mineralDamping = 0.174 * Math.pow(0.01, -0.19);
  const netDead = fuel.load * (1 - 0.0555);
  const netLive = liveLoad * (1 - 0.0555);
  const reactionIntensity = gamma * 8000 * mineralDamping * (netDead * deadDamping + netLive * liveDamping);
  const windMph = input.windKph * 0.621371;
  const midflameFpm = windMph * 88 * (fuel.waf || MIDFLAME_FACTOR) * clamp(Number(input.wafScale) || 1, NIGHT_WAF_FLOOR, 1);
  const windC = 7.47 * Math.exp(-0.133 * Math.pow(sigma, 0.55));
  const windB = 0.02526 * Math.pow(sigma, 0.54);
  const windE = 0.715 * Math.exp(-3.59e-4 * sigma);
  const windFactor = windC * Math.pow(Math.max(0, midflameFpm), windB) * Math.pow(ratio, -windE);
  // Une pente absente produisait Math.tan(NaN), donc une vitesse NaN propagee
  // silencieusement dans tout le modele. On retombe sur le terrain plat.
  const slopeDegrees = Number.isFinite(input.slopeDegrees) ? input.slopeDegrees : 0;
  const slopeFactor = 5.275 * Math.pow(beta, -0.3) * Math.tan((slopeDegrees * Math.PI) / 180) ** 2;
  const propagatingFlux = Math.exp((0.792 + 0.681 * Math.sqrt(sigma)) * (beta + 0.1)) / (192 + 0.2595 * sigma);
  const effectiveHeating = Math.exp(-138 / sigma);
  // Qig pondere par la charge : allumer du vegetal vert coute bien plus cher.
  const qigDead = 250 + 1116 * input.moisture;
  const qigLive = 250 + 1116 * liveMoisture;
  const heatOfPreignition = (fuel.load * qigDead + (fuel.liveLoad || 0) * qigLive) / Math.max(1e-6, totalLoad);
  const bulkDensity = totalLoad / fuel.depth;
  const feetPerMinute = (reactionIntensity * propagatingFlux * (1 + windFactor + slopeFactor)) / Math.max(0.001, bulkDensity * effectiveHeating * heatOfPreignition);
  const metresPerMinute = feetPerMinute * 0.3048 * (fuel.multiplier || 1);
  return Number.isFinite(metresPerMinute) ? Math.max(0, metresPerMinute) : 0;
}

/* ---------------------------------------------------------------------------
 * Combustibles.
 *
 * L'ancienne table decrivait quatre types landais et la carte etait un motif
 * fige dans l'espace de la grille : le moteur croyait simuler du pin maritime
 * partout sur la Terre, et deplacer le cadrage deplacait une riviere fictive,
 * ce qui faisait varier la surface d'un facteur vingt sur un meme feu.
 *
 * On repart des modeles de combustible standard (Anderson 1982, Scott &
 * Burgan 2005), auxquels on rattache un registre d'especes reelles. Chaque
 * espece declare sa presence relative par region : la mosaique est tiree de
 * ces proportions, et le bruit qui la dessine est ancre sur les coordonnees
 * geographiques -- un meme lieu redonne toujours le meme paysage, quel que
 * soit le cadrage de la fenetre.
 *
 * load : litiere fine 1 h en lb/ft2 (entree de Rothermel)
 * depth : epaisseur du lit de combustible en pieds
 * savr : rapport surface/volume en 1/ft
 * mx : teneur en eau d'extinction
 * consumed : combustible consomme dans le front de flammes en kg/m2 (Byram)
 * ------------------------------------------------------------------------- */
const FUEL_MODELS = {
  // Herbacees
  GR1: { label: 'Herbe rase',            load: 0.034, depth: 0.4, savr: 3500, mx: 0.15, consumed: 0.20, liveLoad: 0.01, waf: 0.50 },
  GR2: { label: 'Herbe haute',           load: 0.092, depth: 1.0, savr: 3000, mx: 0.15, consumed: 0.45, liveLoad: 0.02, waf: 0.50 },
  GR4: { label: 'Herbe continue sèche',  load: 0.138, depth: 2.0, savr: 2000, mx: 0.15, consumed: 0.70, liveLoad: 0.03, waf: 0.50 },
  // Herbe et arbustes melanges
  GS2: { label: 'Herbe et arbustes',     load: 0.110, depth: 1.5, savr: 2000, mx: 0.20, consumed: 0.90, liveLoad: 0.06, waf: 0.45 },
  // Arbustes
  SH2: { label: 'Arbustes bas',          load: 0.115, depth: 1.0, savr: 2000, mx: 0.20, consumed: 1.10, liveLoad: 0.08, waf: 0.45 },
  SH5: { label: 'Arbustes hauts secs',   load: 0.252, depth: 6.0, savr: 1600, mx: 0.15, consumed: 2.60, liveLoad: 0.20, waf: 0.40 },
  SH7: { label: 'Arbustes très denses',  load: 0.312, depth: 6.0, savr: 1600, mx: 0.15, consumed: 3.20, liveLoad: 0.25, waf: 0.38 },
  // Litieres forestieres
  TL2: { label: 'Litière feuillus',      load: 0.062, depth: 0.2, savr: 2000, mx: 0.25, consumed: 0.55, liveLoad: 0.00, waf: 0.12 },
  TL8: { label: 'Litière résineux',      load: 0.138, depth: 0.3, savr: 1800, mx: 0.35, consumed: 0.95, liveLoad: 0.00, waf: 0.12 },
  // Forets avec sous-etage
  TU1: { label: 'Sous-bois clair',       load: 0.092, depth: 0.6, savr: 2000, mx: 0.20, consumed: 1.10, liveLoad: 0.02, waf: 0.30 },
  TU5: { label: 'Sous-bois dense',       load: 0.184, depth: 1.0, savr: 1800, mx: 0.25, consumed: 2.00, liveLoad: 0.05, waf: 0.28 },
  // Cultures et sols nus
  AGR: { label: 'Culture',               load: 0.030, depth: 0.4, savr: 1900, mx: 0.18, consumed: 0.25, liveLoad: 0.01, waf: 0.50 },
  ROC: { label: 'Rocaille',              nonBurnable: true },
  URB: { label: 'Zone bâtie',            nonBurnable: true },
  EAU: { label: 'Eau',                   nonBurnable: true },
};

/* Registre d'especes. `regions` donne la part de surface occupee dans chaque
 * region ; les valeurs sont normalisees a la generation. */
const SPECIES = [
  // --- Gironde : massif des Landes de Gascogne -----------------------------
  { id: 'pinus-pinaster',   nom: 'Pin maritime',        latin: 'Pinus pinaster',        strate: 'conifère', model: 'TU5', regions: { gironde: 0.44, marseille: 0.04 } },
  { id: 'pinus-pinaster-j', nom: 'Pin maritime (jeune)', latin: 'Pinus pinaster',       strate: 'conifère', model: 'TU1', regions: { gironde: 0.14 } },
  { id: 'molinia',          nom: 'Molinie bleue',       latin: 'Molinia caerulea',      strate: 'herbacée', model: 'GR4', regions: { gironde: 0.09 } },
  { id: 'pteridium',        nom: 'Fougère aigle',       latin: 'Pteridium aquilinum',   strate: 'herbacée', model: 'GS2', regions: { gironde: 0.06, marseille: 0.01 } },
  { id: 'ulex-europaeus',   nom: 'Ajonc d’Europe',      latin: 'Ulex europaeus',        strate: 'arbustive', model: 'SH5', regions: { gironde: 0.05 } },
  { id: 'calluna',          nom: 'Bruyère callune',     latin: 'Calluna vulgaris',      strate: 'arbustive', model: 'SH2', regions: { gironde: 0.04 } },
  { id: 'quercus-robur',    nom: 'Chêne pédonculé',     latin: 'Quercus robur',         strate: 'feuillu',  model: 'TL2', regions: { gironde: 0.04 } },
  { id: 'quercus-pyrenaica', nom: 'Chêne tauzin',       latin: 'Quercus pyrenaica',     strate: 'feuillu',  model: 'TL2', regions: { gironde: 0.03 } },
  { id: 'coupe-rase',       nom: 'Coupe rase',          latin: '—',                     strate: 'ouverte',  model: 'GR2', regions: { gironde: 0.06 } },
  { id: 'zea-mays',         nom: 'Maïs / culture',      latin: 'Zea mays',              strate: 'culture',  model: 'AGR', regions: { gironde: 0.05, 'california-chaparral': 0.03 } },

  // --- Marseille : Provence calcaire ---------------------------------------
  { id: 'pinus-halepensis', nom: 'Pin d’Alep',          latin: 'Pinus halepensis',      strate: 'conifère', model: 'TU5', regions: { marseille: 0.30 } },
  { id: 'quercus-ilex',     nom: 'Chêne vert',          latin: 'Quercus ilex',          strate: 'feuillu',  model: 'TU1', regions: { marseille: 0.16 } },
  { id: 'quercus-coccifera', nom: 'Chêne kermès',       latin: 'Quercus coccifera',     strate: 'arbustive', model: 'SH5', regions: { marseille: 0.12 } },
  { id: 'garrigue',         nom: 'Garrigue (romarin, thym, ciste)', latin: 'Rosmarinus / Cistus', strate: 'arbustive', model: 'SH2', regions: { marseille: 0.14 } },
  { id: 'juniperus-oxy',    nom: 'Genévrier cade',      latin: 'Juniperus oxycedrus',   strate: 'arbustive', model: 'SH5', regions: { marseille: 0.05 } },
  { id: 'arbutus',          nom: 'Arbousier (maquis)',  latin: 'Arbutus unedo',         strate: 'arbustive', model: 'SH7', regions: { marseille: 0.05 } },
  { id: 'pinus-pinea',      nom: 'Pin parasol',         latin: 'Pinus pinea',           strate: 'conifère', model: 'TL8', regions: { marseille: 0.03 } },
  { id: 'olea',             nom: 'Oliveraie',           latin: 'Olea europaea',         strate: 'culture',  model: 'AGR', regions: { marseille: 0.04 } },
  { id: 'brachypodium',     nom: 'Pelouse sèche',       latin: 'Brachypodium retusum',  strate: 'herbacée', model: 'GR1', regions: { marseille: 0.04 } },
  { id: 'calcaire',         nom: 'Barre rocheuse',      latin: '—',                     strate: 'minérale', model: 'ROC', regions: { marseille: 0.03 } },

  // --- Californie : Grand Bassin, chaparral et forets ----------------------
  { id: 'artemisia',        nom: 'Armoise (big sagebrush)', latin: 'Artemisia tridentata', strate: 'arbustive', model: 'SH2', regions: { 'california-basin': 0.30 } },
  { id: 'bromus-tectorum',  nom: 'Brome des toits',     latin: 'Bromus tectorum',       strate: 'herbacée', model: 'GR2', regions: { 'california-basin': 0.24 } },
  { id: 'purshia',          nom: 'Bitterbrush',         latin: 'Purshia tridentata',    strate: 'arbustive', model: 'SH2', regions: { 'california-basin': 0.10 } },
  { id: 'pinus-monophylla', nom: 'Pin à feuille unique', latin: 'Pinus monophylla',     strate: 'conifère', model: 'TU1', regions: { 'california-basin': 0.12, 'california-sierra': 0.08 } },
  { id: 'juniperus-osteo',  nom: 'Genévrier de l’Utah', latin: 'Juniperus osteosperma', strate: 'conifère', model: 'TU1', regions: { 'california-basin': 0.11 } },
  { id: 'adenostoma',       nom: 'Chamise (chaparral)', latin: 'Adenostoma fasciculatum', strate: 'arbustive', model: 'SH5', regions: { 'california-chaparral': 0.30 } },
  { id: 'arctostaphylos',   nom: 'Manzanita',           latin: 'Arctostaphylos spp.',   strate: 'arbustive', model: 'SH7', regions: { 'california-chaparral': 0.16, 'california-sierra': 0.10 } },
  { id: 'ceanothus',        nom: 'Ceanothus',           latin: 'Ceanothus spp.',        strate: 'arbustive', model: 'SH5', regions: { 'california-chaparral': 0.14 } },
  { id: 'quercus-agrifolia', nom: 'Chêne vert de Californie', latin: 'Quercus agrifolia', strate: 'feuillu', model: 'TL2', regions: { 'california-chaparral': 0.10 } },
  { id: 'quercus-douglasii', nom: 'Chêne bleu',         latin: 'Quercus douglasii',     strate: 'feuillu',  model: 'TL2', regions: { 'california-chaparral': 0.08, 'california-sierra': 0.08 } },
  { id: 'pinus-ponderosa',  nom: 'Pin ponderosa',       latin: 'Pinus ponderosa',       strate: 'conifère', model: 'TL8', regions: { 'california-sierra': 0.26 } },
  { id: 'pinus-jeffreyi',   nom: 'Pin de Jeffrey',      latin: 'Pinus jeffreyi',        strate: 'conifère', model: 'TL8', regions: { 'california-sierra': 0.18 } },
  { id: 'pseudotsuga',      nom: 'Douglas',             latin: 'Pseudotsuga menziesii', strate: 'conifère', model: 'TU5', regions: { 'california-sierra': 0.16 } },
  { id: 'avena-bromus',     nom: 'Prairie annuelle',    latin: 'Avena / Bromus',        strate: 'herbacée', model: 'GR4', regions: { 'california-basin': 0.08, 'california-chaparral': 0.18, 'california-sierra': 0.08 } },
  { id: 'playa',            nom: 'Sol nu / rocaille',   latin: '—',                     strate: 'minérale', model: 'ROC', regions: { 'california-basin': 0.05, 'california-chaparral': 0.04, 'california-sierra': 0.06 } },
];

/* Codes numeriques : la grille est un Uint8Array. */
const URBAN_CODE = 254;
const WATER_CODE = 255;
const FUEL = {};
SPECIES.forEach((species, index) => {
  const model = FUEL_MODELS[species.model];
  species.code = index;
  FUEL[index] = {
    name: species.nom, species: species.id, latin: species.latin, strate: species.strate,
    model: species.model, modelLabel: model.label,
    nonBurnable: Boolean(model.nonBurnable),
    load: model.load, depth: model.depth, savr: model.savr,
    liveLoad: model.liveLoad || 0, waf: model.waf || 0.25,
    moistureExtinction: model.mx, consumedKgM2: model.consumed,
    // Plus aucun coefficient d'ajustement : Rothermel est utilise tel quel.
    multiplier: 1,
  };
});
FUEL[URBAN_CODE] = { name: 'Zone bâtie', nonBurnable: true, strate: 'urbaine' };
FUEL[WATER_CODE] = { name: 'Eau', nonBurnable: true, strate: 'hydrique' };

const REGIONS = {
  'gironde':              { label: 'Landes de Gascogne',      pays: 'France' },
  'marseille':            { label: 'Provence calcaire',       pays: 'France' },
  'california-basin':     { label: 'Grand Bassin (steppe à armoise)', pays: 'États-Unis' },
  'california-chaparral': { label: 'Chaparral cismontain',    pays: 'États-Unis' },
  'california-sierra':    { label: 'Sierra Nevada (forêt montagnarde)', pays: 'États-Unis' },
};
// L'ancien identifiant unique pointait sur un melange incoherent ; il retombe
// desormais sur la steppe, ou se sont produits les grands feux de 2026.
const REGION_ALIAS = { california: 'california-basin' };
function speciesMix(rawRegion) {
  const region = REGIONS[rawRegion] ? rawRegion : (REGION_ALIAS[rawRegion] || 'gironde');
  const entries = SPECIES
    .filter((s) => (s.regions[region] || 0) > 0)
    .map((s) => ({ code: s.code, weight: s.regions[region] }));
  const total = entries.reduce((sum, e) => sum + e.weight, 0) || 1;
  let cumulative = 0;
  return entries.map((e) => { cumulative += e.weight / total; return { code: e.code, upTo: cumulative }; });
}

/* Bruit ancre sur la geographie : le meme lieu redonne toujours le meme
 * paysage, quel que soit le centrage de la fenetre de simulation. */
function hashLattice(ix, iy, salt) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x, y, salt) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hashLattice(ix, iy, salt), b = hashLattice(ix + 1, iy, salt);
  const c = hashLattice(ix, iy + 1, salt), d = hashLattice(ix + 1, iy + 1, salt);
  const top = a + (b - a) * sx, bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}
function fractalNoise(x, y, salt) {
  let value = 0, amplitude = 0.5, frequency = 1, norm = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    value += amplitude * valueNoise(x * frequency, y * frequency, salt + octave);
    norm += amplitude; frequency *= 2; amplitude *= 0.5;
  }
  return value / norm;
}
const PATCH_METRES = 900; // taille caracteristique d'un peuplement
function landscapeField(mx, my) {
  return fractalNoise(mx, my, 1013) + (fractalNoise(mx * 3.1, my * 3.1, 7717) - 0.5) * 0.12;
}
// Distribution de reference du champ, echantillonnee loin de toute region.
const FIELD_CDF = (() => {
  const samples = new Float64Array(8192);
  for (let i = 0; i < samples.length; i += 1) {
    const x = ((i * 7919) % 2039) + (i % 37) * 0.317;
    const y = ((i * 6271) % 1811) + (i % 53) * 0.173;
    samples[i] = landscapeField(x, y);
  }
  return samples.sort();
})();
function fieldQuantile(value) {
  let low = 0, high = FIELD_CDF.length;
  while (low < high) { const mid = (low + high) >> 1; if (FIELD_CDF[mid] < value) low = mid + 1; else high = mid; }
  return low / FIELD_CDF.length;
}

/* Espece a une coordonnee exacte, independamment de toute grille : c est ce
 * qui garantit qu un lieu garde sa vegetation quel que soit le cadrage. */
function speciesAt(lng, lat, region) {
  const mix = speciesMix(region);
  const mx = (lng * 111320 * Math.cos(lat * Math.PI / 180)) / PATCH_METRES;
  const my = (lat * 111320) / PATCH_METRES;
  const quantile = fieldQuantile(landscapeField(mx, my));
  let code = mix[mix.length - 1].code;
  for (const entry of mix) if (quantile <= entry.upTo) { code = entry.code; break; }
  return code;
}
function generateFuelMask(terrain) {
  const region = (terrain && terrain.region) || 'gironde';
  const mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
  // Chaque cellule lit l'espece a sa propre coordonnee : la mosaique tient au
  // lieu, jamais a la position de la cellule dans la grille.
  for (let y = 0; y < GRID_SIZE; y += 1) for (let x = 0; x < GRID_SIZE; x += 1) {
    const [lng, lat] = lngLatForCell(x, y);
    mask[indexOf(x, y)] = speciesAt(lng, lat, region);
  }
  if (terrain) applyTerrain(mask, terrain);
  return mask;
}

/* Geographie reelle du scenario : trait de cote, plans d'eau, zones baties.
 * Sans elle un feu cotier se propage sur la mer, ce qui rend toute
 * comparaison avec un evenement reel sans objet. */
function applyTerrain(mask, terrain) {
  const metresBetween = (lng, lat, point) => Math.hypot(
    (lng - point.lng) * 111320 * Math.cos(lat * Math.PI / 180),
    (lat - point.lat) * 111320,
  );
  for (let y = 0; y < GRID_SIZE; y += 1) for (let x = 0; x < GRID_SIZE; x += 1) {
    const [lng, lat] = lngLatForCell(x, y);
    let code = mask[indexOf(x, y)];
    if (Number.isFinite(terrain.oceanWestOfLng) && lng < terrain.oceanWestOfLng) code = WATER_CODE;
    for (const body of terrain.water || []) if (metresBetween(lng, lat, body) < body.radiusM) code = WATER_CODE;
    for (const town of terrain.urban || []) if (metresBetween(lng, lat, town) < town.radiusM) code = URBAN_CODE;
    mask[indexOf(x, y)] = code;
  }
}

/* Raster Gironde pre-cuit, indexe par longitude/latitude absolues. Les valeurs
 * 255 gardent la mosaique procedurale : l'asset complete le paysage sans faire
 * dependre les cellules du cadrage courant. */
function decodeLandscape(asset) {
  if (!asset || !asset.bounds || !Number.isFinite(asset.gridSize)) return null;
  const bytes = (value) => {
    const binary = atob(value || '');
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
    return output;
  };
  const populationBytes = bytes(asset.people10);
  return {
    gridSize: asset.gridSize, bounds: asset.bounds, sources: asset.sources || {},
    fuel: bytes(asset.fuel), infra: bytes(asset.infra), slope: bytes(asset.slope), aspect: bytes(asset.aspect),
    people10: new Uint16Array(populationBytes.buffer, populationBytes.byteOffset, populationBytes.byteLength / 2),
  };
}
function landscapeIndexAt(landscape, lng, lat) {
  const bounds = landscape && landscape.bounds;
  if (!bounds || lng < bounds.west || lng >= bounds.east || lat < bounds.south || lat >= bounds.north) return -1;
  const x = clamp(Math.floor((lng - bounds.west) / (bounds.east - bounds.west) * landscape.gridSize), 0, landscape.gridSize - 1);
  const y = clamp(Math.floor((bounds.north - lat) / (bounds.north - bounds.south) * landscape.gridSize), 0, landscape.gridSize - 1);
  return y * landscape.gridSize + x;
}
function applyLandscape(fuel, anthropic, asset) {
  const landscape = decodeLandscape(asset);
  if (!landscape) return { anthropic, slope: null, aspect: null, sources: null, appliedCells: 0 };
  const infra = anthropic ? anthropic.infra : new Uint8Array(GRID_SIZE * GRID_SIZE);
  const people = anthropic ? anthropic.people : new Float32Array(GRID_SIZE * GRID_SIZE);
  const slope = new Float32Array(GRID_SIZE * GRID_SIZE);
  const aspect = new Float32Array(GRID_SIZE * GRID_SIZE);
  let appliedCells = 0;
  for (let y = 0; y < GRID_SIZE; y += 1) for (let x = 0; x < GRID_SIZE; x += 1) {
    const index = indexOf(x, y);
    const [lng, lat] = lngLatForCell(x, y);
    const sourceIndex = landscapeIndexAt(landscape, lng, lat);
    if (sourceIndex < 0) continue;
    appliedCells += 1;
    if (landscape.fuel[sourceIndex] !== 255) fuel[index] = landscape.fuel[sourceIndex];
    infra[index] = landscape.infra[sourceIndex];
    people[index] = landscape.people10[sourceIndex] / 10;
    slope[index] = landscape.slope[sourceIndex];
    aspect[index] = landscape.aspect[sourceIndex] / 255 * 360;
  }
  // Le raster est charge une fois pour toutes, mais il ne couvre que la Gironde.
  // Sur un domaine situe ailleurs aucune cellule n'est reprise : fabriquer malgre
  // tout un calque d'infrastructure vide faisait afficher un bilan d'enjeux a
  // zero -- et un reseau etiquete « Landes » -- sur Marseille et la Californie.
  if (!appliedCells) return { anthropic, slope: null, aspect: null, sources: null, appliedCells: 0 };
  return { anthropic: { infra, people, spec: anthropic ? anthropic.spec : NETWORKS.landes }, slope, aspect,
    sources: landscape.sources, appliedCells };
}
/* ---------------------------------------------------------------------------
 * Anthropisation du massif : pistes DFCI, routes, bati, habitants.
 *
 * Le massif landais n'est pas une nappe de pin continue : il est quadrille par
 * un maillage de pistes DFCI, coupe de routes, et parseme de fermes et de
 * hameaux. C'est cette structure, et non la puissance des moyens, qui
 * compartimente reellement les feux de la region.
 *
 * Le reseau est engendre depuis les coordonnees absolues, comme la vegetation :
 * il existe independamment de tout incendie et ne connait aucun scenario. Une
 * coupure n'arrete pas le feu par decret -- elle le tient tant que la flamme
 * est plus courte que la coupure n'est large, et cede quand l'intensite monte.
 * ------------------------------------------------------------------------- */
const INFRA_TRACK = 1;  // piste DFCI
const INFRA_ROAD = 2;   // route ouverte a la circulation
const INFRA_BUILT = 4;  // bati, avec son debroussaillement reglementaire

const NETWORKS = {
  landes: {
    label: 'Landes de Gascogne',
    trackSpacingM: 1100,   // maille DFCI du massif
    trackWidthM: 14,       // piste et accotements entretenus
    roadSpacingM: 7500,    // departementales
    roadWidthM: 26,
    hamletSpacingM: 3800,  // airials, fermes et hameaux disperses
    hamletPresence: 0.62,  // tous les noeuds du maillage ne sont pas batis
    // Debroussaillement reglementaire de 50 m : partiellement efficace.
    builtBreakM: 34,
    peoplePerHectareBuilt: 6,
  },
};

/* Distance au fil du maillage le plus proche, le long d'un axe. */
function latticeDistance(value, spacing) {
  const modulo = ((value % spacing) + spacing) % spacing;
  return Math.min(modulo, spacing - modulo);
}

function buildInfrastructure(networkKey, terrain) {
  const spec = NETWORKS[networkKey];
  if (!spec) return null;
  const infra = new Uint8Array(GRID_SIZE * GRID_SIZE);
  const people = new Float32Array(GRID_SIZE * GRID_SIZE);
  const cellHa = (CELL_METERS * CELL_METERS) / 10000;
  const half = CELL_METERS / 2;
  for (let y = 0; y < GRID_SIZE; y += 1) for (let x = 0; x < GRID_SIZE; x += 1) {
    const index = indexOf(x, y);
    const [lng, lat] = lngLatForCell(x, y);
    const metresX = lng * 111320 * Math.cos(lat * Math.PI / 180);
    const metresY = lat * 111320;
    let flags = 0;

    // Un maillage parfaitement regulier se verrait ; on le laisse respirer.
    const wobbleX = (fractalNoise(metresX / 5200, metresY / 5200, 4211) - 0.5) * spec.trackSpacingM * 0.4;
    const wobbleY = (fractalNoise(metresX / 5200, metresY / 5200, 8123) - 0.5) * spec.trackSpacingM * 0.4;
    if (latticeDistance(metresX + wobbleX, spec.trackSpacingM) < half
      || latticeDistance(metresY + wobbleY, spec.trackSpacingM) < half) flags |= INFRA_TRACK;

    const roadWobbleX = (fractalNoise(metresX / 21000, metresY / 21000, 3307) - 0.5) * spec.roadSpacingM * 0.5;
    const roadWobbleY = (fractalNoise(metresX / 21000, metresY / 21000, 5501) - 0.5) * spec.roadSpacingM * 0.5;
    if (latticeDistance(metresX + roadWobbleX, spec.roadSpacingM) < half
      || latticeDistance(metresY + roadWobbleY, spec.roadSpacingM) < half) flags |= INFRA_ROAD;

    // Hameaux : un noeud sur deux environ porte du bati, decale et de taille
    // variable, ce qui donne la dispersion caracteristique des airials.
    const nodeX = Math.round(metresX / spec.hamletSpacingM);
    const nodeY = Math.round(metresY / spec.hamletSpacingM);
    if (hashLattice(nodeX, nodeY, 9137) < spec.hamletPresence) {
      const offsetX = (hashLattice(nodeX, nodeY, 2711) - 0.5) * spec.hamletSpacingM * 0.55;
      const offsetY = (hashLattice(nodeX, nodeY, 6053) - 0.5) * spec.hamletSpacingM * 0.55;
      const radius = 140 + hashLattice(nodeX, nodeY, 4441) * 320;
      const distance = Math.hypot(metresX - (nodeX * spec.hamletSpacingM + offsetX),
        metresY - (nodeY * spec.hamletSpacingM + offsetY));
      if (distance < radius) flags |= INFRA_BUILT;
    }

    // Les agglomerations nommees par le scenario priment sur le procedural.
    for (const town of (terrain && terrain.urban) || []) {
      const townX = town.lng * 111320 * Math.cos(town.lat * Math.PI / 180);
      const townY = town.lat * 111320;
      if (Math.hypot(metresX - townX, metresY - townY) < town.radiusM) {
        flags |= INFRA_BUILT;
        people[index] = ((town.population || 0) / Math.max(1, Math.PI * (town.radiusM / 100) ** 2)) * cellHa;
      }
    }
    if ((flags & INFRA_BUILT) && !people[index]) people[index] = spec.peoplePerHectareBuilt * cellHa;
    infra[index] = flags;
  }
  return { infra, people, spec };
}

/* Largeur de la coupure a franchir sur une cellule. */
function breakWidthAt(sim, index) {
  let width = sim.constructedBreak ? sim.constructedBreak[index] : 0;
  const flags = sim.infra ? sim.infra[index] : 0;
  const spec = sim.network;
  if (flags & INFRA_ROAD) width = Math.max(width, spec.roadWidthM);
  if (flags & INFRA_TRACK) width = Math.max(width, spec.trackWidthM);
  if (flags & INFRA_BUILT) width = Math.max(width, spec.builtBreakM);
  return width;
}

/* Une coupure tient tant qu'elle est plus large que ~2,5 longueurs de flamme.
 * Au-dela, elle ne fait plus que retarder le front -- et les brandons la
 * franchissent de toute facon. */
function crossingDelayMinutes(width, intensityKwM, rosMetresPerMinute, windKph, held = false) {
  if (width <= 0) return 0;
  const flameLength = 0.0775 * Math.pow(Math.max(1, intensityKwM), 0.46);
  // Une flamme couchee par le vent porte bien au-dela de sa hauteur.
  const crossable = 2.5 * flameLength * (1 + 0.02 * Math.max(0, windKph || 0));
  const direct = width / Math.max(0.1, rosMetresPerMinute);
  if (width <= crossable) return direct;
  // Le front bute, s'accumule, et ne passe qu'a la faveur d'une rafale ou
  // d'un brandon : des heures de retard, jamais un blocage definitif.
  // Une coupure laissee sans personnel ne tient pas des heures : braises
  // courtes et rayonnement la franchissent. Elle retarde le front de quelques
  // dizaines de minutes, le temps que les moyens s en saisissent -- c est la
  // suppression, pas la coupure seule, qui arrete un feu.
  // Gannon et al. 2023 (Fire 6:104) identifient la suppression comme le
  // premier determinant de succes des coupures. Une ligne tenue multiplie le
  // temps de franchissement, mais garde une borne : aucune barriere absolue.
  return Math.min(direct * Math.pow(width / crossable, 3) * 12 * (held ? 4 : 1), held ? 360 : 90);
}

function createState(origin) {
  const state = new Uint8Array(GRID_SIZE * GRID_SIZE);
  const arrival = new Float32Array(GRID_SIZE * GRID_SIZE); arrival.fill(Infinity);
  const lowIntensitySince = new Float32Array(GRID_SIZE * GRID_SIZE); lowIntensitySince.fill(Infinity);
  const constructedBreak = new Float32Array(GRID_SIZE * GRID_SIZE);
  const heldBreak = new Uint8Array(GRID_SIZE * GRID_SIZE);
  const terrain = (origin && origin.terrain) || null;
  const fuel = generateFuelMask(terrain);
  // Le reseau n'existe que la ou il est decrit : pour l'instant le massif landais.
  // Un 'network' explicitement fourni prime, y compris null pour desactiver.
  const networkKey = terrain && (terrain.network !== undefined ? terrain.network : (terrain.region === 'gironde' ? 'landes' : null));
  let anthropic = networkKey ? buildInfrastructure(networkKey, terrain) : null;
  const landscapeResult = applyLandscape(fuel, anthropic, origin && origin.landscape);
  // Les plans d'eau et agglomerations explicites du scenario restent
  // non combustibles apres l'injection des peuplements forestiers reels.
  if (terrain) applyTerrain(fuel, terrain);
  anthropic = landscapeResult.anthropic;
  // Un allumage sur une cellule non combustible ne partirait jamais : on glisse
  // vers la plus proche cellule qui brule.
  const burnableCellNear = (start) => {
    if (!FUEL[fuel[indexOf(start.x, start.y)]].nonBurnable) return start;
    for (let radius = 1; radius < GRID_SIZE; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
        const x = start.x + dx, y = start.y + dy;
        if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;
        if (!FUEL[fuel[indexOf(x, y)]].nonBurnable) return { x, y };
      }
    }
    return start;
  };
  // Un foyer peut couvrir un disque : l'operateur regle sa taille en glissant
  // sur la carte, plutot que via un champ numerique.
  const seedDisc = (spot) => {
    const cell = burnableCellNear(spot && Number.isFinite(spot.lng) && Number.isFinite(spot.lat)
      ? cellForLngLat(spot.lng, spot.lat)
      : { x: Math.floor(GRID_SIZE / 2), y: Math.floor(GRID_SIZE / 2) });
    const radiusM = Math.max(0, Number(spot && spot.radiusM) || 0);
    const reach = Math.min(GRID_SIZE, Math.ceil(radiusM / CELL_METERS));
    let seeded = 0;
    for (let dy = -reach; dy <= reach; dy += 1) for (let dx = -reach; dx <= reach; dx += 1) {
      const x = cell.x + dx, y = cell.y + dy;
      if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;
      if (Math.hypot(dx, dy) * CELL_METERS > radiusM) continue;
      if (FUEL[fuel[indexOf(x, y)]].nonBurnable) continue;
      arrival[indexOf(x, y)] = 0; seeded += 1;
    }
    if (!seeded) arrival[indexOf(cell.x, cell.y)] = 0;
    const [lng, lat] = lngLatForCell(cell.x, cell.y);
    return { lng, lat, radiusM };
  };
  const primary = seedDisc(origin);
  // Les foyers secondaires sont semes dans la meme grille : ils grandissent
  // chacun de leur cote puis fusionnent s'ils se rejoignent, ce qui est le
  // comportement reel d'un feu a plusieurs departs. Le contour sait deja rendre
  // plusieurs anneaux disjoints (MultiPolygon), rien d'autre n'a a changer.
  const extras = (Array.isArray(origin && origin.extraIgnitions) ? origin.extraIgnitions : [])
    .slice(0, MAX_EXTRA_IGNITIONS)
    .map(seedDisc);
  return {
    state, arrival, lowIntensitySince, constructedBreak, heldBreak, lineProgressM: {}, lineCellsBuilt: {},
    explicitLinesReady: false, tacticalBurnsReady: false,
    fuel, currentMinutes: 0, ignition: primary, extraIgnitions: extras,
    infra: anthropic && anthropic.infra, people: anthropic && anthropic.people,
    network: anthropic && anthropic.spec,
    slope: landscapeResult.slope, aspect: landscapeResult.aspect,
    landscapeSources: landscapeResult.sources, landscapeAppliedCells: landscapeResult.appliedCells,
  };
}
function lngLatForCell(x, y) { return [BOUNDS.west + ((x + 0.5) / GRID_SIZE) * (BOUNDS.east - BOUNDS.west), BOUNDS.north - ((y + 0.5) / GRID_SIZE) * (BOUNDS.north - BOUNDS.south)]; }
function cellForLngLat(lng, lat) { return { x: clamp(Math.floor(((lng - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * GRID_SIZE), 0, GRID_SIZE - 1), y: clamp(Math.floor(((BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south)) * GRID_SIZE), 0, GRID_SIZE - 1) }; }

/* ---------------------------------------------------------------------------
 * Extinction : debit d'eau reel contre intensite de front (Byram 1959).
 *
 * L'ancien modele appliquait un coefficient abstrait par engin. Ici chaque
 * engin porte ses caracteristiques reelles, et l'efficacite depend de
 * l'intensite locale du feu -- au-dela d'un seuil, aucune quantite d'eau ne
 * suffit en attaque directe, ce qui est le comportement operationnel reel.
 * ------------------------------------------------------------------------- */
/* Humidite du combustible fin mort, derivee de la meteo (Simard / Fosberg).
 * L'ancienne version recevait une constante 0,08 : les curseurs temperature,
 * humidite et secheresse de l'interface n'avaient aucun effet sur le feu. */
function deriveMoisture(input) {
  const rh = Number(input.humidity), tc = Number(input.temperature);
  if (!Number.isFinite(rh) || !Number.isFinite(tc)) {
    return Number.isFinite(input.moisture) ? clamp(input.moisture, 0.02, 0.4) : 0.08;
  }
  const tf = tc * 9 / 5 + 32;
  // Teneur en eau d'equilibre, en pourcent de la masse seche.
  const emc = rh < 10 ? 0.03229 + 0.281073 * rh - 0.000578 * rh * tf
    : rh < 50 ? 2.22749 + 0.160107 * rh - 0.014784 * tf
    : 21.0606 + 0.005565 * rh * rh - 0.00035 * rh * tf - 0.483199 * rh;
  // La secheresse cumulee asseche la litiere sous l'equilibre instantane.
  const drought = clamp(Number(input.droughtIndex) || 0, 0, 1);
  return clamp((emc / 100) * (1 - 0.35 * drought), 0.02, 0.4);
}
const HEAT_YIELD_KJ_KG = 18600;      // chaleur de combustion, valeur standard
const LB_FT2_TO_KG_M2 = 4.882;
const DIRECT_ATTACK_LIMIT_KW_M = 4000;  // au-dela : attaque directe inoperante
const HAND_ATTACK_LIMIT_KW_M = 2000;    // au-dela : moyens lourds seulement
const FLOW_PER_METRE_DIVISOR = 400;     // L/min par metre de front, par kW/m

// tankL : capacite ; flowLpm : debit pompe en attaque ; refillMin : aller-retour
// remplissage. Le debit soutenu tient compte du temps de reapprovisionnement.
const APPLIANCES = {
  // --- Moyens terrestres --------------------------------------------------
  VLHR:  { label: 'Véhicule léger hors route',   famille: 'terrestre', tankL: 600,   flowLpm: 250,  refillMin: 15, offRoad: true,  heavy: false },
  CCF:   { label: 'Camion-citerne feux de forêts', famille: 'terrestre', tankL: 4000,  flowLpm: 1000, refillMin: 20, offRoad: true,  heavy: false },
  CCFS:  { label: 'Camion-citerne super',        famille: 'terrestre', tankL: 8000,  flowLpm: 2000, refillMin: 25, offRoad: true,  heavy: true },
  FPT:   { label: 'Fourgon pompe-tonne',         famille: 'terrestre', tankL: 3000,  flowLpm: 2000, refillMin: 25, offRoad: false, heavy: false },
  CCGC:  { label: 'Camion-citerne grande capacité', famille: 'terrestre', tankL: 13000, flowLpm: 2000, refillMin: 35, offRoad: false, heavy: true },
  // --- Moyens aeriens -----------------------------------------------------
  HBE:   { label: 'Hélicoptère bombardier d’eau', famille: 'aérien',   tankL: 1000,  flowLpm: 1000, refillMin: 8,  offRoad: true,  heavy: true },
  HELIT: { label: 'Hélicoptère lourd S-64',      famille: 'aérien',   tankL: 9500,  flowLpm: 9500, refillMin: 14, offRoad: true,  heavy: true },
  AT8:   { label: 'Air Tractor AT-802F',         famille: 'aérien',   tankL: 3100,  flowLpm: 3100, refillMin: 18, offRoad: true,  heavy: true },
  CL4:   { label: 'Canadair CL-415',             famille: 'aérien',   tankL: 6137,  flowLpm: 6137, refillMin: 13, offRoad: true,  heavy: true },
  DASH:  { label: 'Dash-8 Q400MR',               famille: 'aérien',   tankL: 10000, flowLpm: 10000, refillMin: 30, offRoad: true, heavy: true },
  A400:  { label: 'A400M (retardant)',           famille: 'aérien',   tankL: 20000, flowLpm: 20000, refillMin: 90, offRoad: true, heavy: true },
  // --- Genie et travail manuel -------------------------------------------
  DOZ:   { label: 'Bulldozer',                   famille: 'génie',    tankL: 0, flowLpm: 0, refillMin: 0, offRoad: true, heavy: true, lineMetresPerHour: 320 },
  CREW:  { label: 'Équipe au sol (20 sapeurs)',  famille: 'génie',    tankL: 0, flowLpm: 0, refillMin: 0, offRoad: true, heavy: false, lineMetresPerHour: 90 },
};
function sustainedFlowLpm(code) {
  const a = APPLIANCES[code]; if (!a || !a.tankL) return 0;
  const attackMin = a.tankL / a.flowLpm;
  return a.tankL / (attackMin + a.refillMin);
}
// Byram : I = H . w . R  (kW/m), avec R en m/s et w en kg/m2.
function firelineIntensity(fuelCode, rosMetresPerMinute) {
  const fuel = FUEL[fuelCode] || FUEL[0];
  if (fuel.nonBurnable) return 0;
  // w = combustible consomme dans le front (kg/m2), pas la seule litiere fine.
  const consumedKgM2 = fuel.consumedKgM2 || fuel.load * LB_FT2_TO_KG_M2;
  return HEAT_YIELD_KJ_KG * consumedKgM2 * (rosMetresPerMinute / 60);
}
// Debit necessaire pour tenir un metre de front a cette intensite.
function requiredFlowPerMetre(intensityKwM) { return intensityKwM / FLOW_PER_METRE_DIVISOR; }

/* Cellules ou le feu touche encore du combustible : c'est la que les engins
 * travaillent reellement. */
function frontCells(sim) {
  const cells = [];
  for (let y = 0; y < GRID_SIZE; y += 1) for (let x = 0; x < GRID_SIZE; x += 1) {
    const index = indexOf(x, y);
    if (!(sim.arrival[index] <= sim.currentMinutes) || sim.state[index] === 3) continue;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
      const n = indexOf(nx, ny);
      if (!(sim.arrival[n] <= sim.currentMinutes) && !FUEL[sim.fuel[n]].nonBurnable) { cells.push([x, y]); break; }
    }
  }
  return cells;
}
function lineCells(coordinates) {
  const cells = [];
  if (!Array.isArray(coordinates) || coordinates.length < 2) return cells;
  for (let p = 1; p < coordinates.length; p += 1) {
    const a = cellForLngLat(Number(coordinates[p - 1][0]), Number(coordinates[p - 1][1]));
    const b = cellForLngLat(Number(coordinates[p][0]), Number(coordinates[p][1]));
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
    for (let step = 0; step <= steps; step += 1) {
      const x = clamp(Math.round(a.x + (b.x - a.x) * step / steps), 0, GRID_SIZE - 1);
      const y = clamp(Math.round(a.y + (b.y - a.y) * step / steps), 0, GRID_SIZE - 1);
      const index = indexOf(x, y);
      if (cells.at(-1) !== index) cells.push(index);
    }
  }
  return cells;
}
function installExplicitLines(sim, input) {
  if (sim.explicitLinesReady) return;
  for (const line of input.firebreaks || []) {
    const width = clamp(Number(line.widthM) || 12, 2, 80);
    for (const index of lineCells(line.coordinates)) {
      sim.constructedBreak[index] = Math.max(sim.constructedBreak[index], width);
      if (line.staffed !== false) sim.heldBreak[index] = 1;
    }
  }
  sim.explicitLinesReady = true;
}
function igniteTacticalBurns(sim, input, bearing) {
  if (sim.tacticalBurnsReady) return;
  const backDx = Math.round(-Math.sin(bearing * Math.PI / 180));
  const backDy = Math.round(Math.cos(bearing * Math.PI / 180));
  for (const line of input.firebreaks || []) {
    if (!line.tacticalBurn) continue;
    for (const barrier of lineCells(line.coordinates)) {
      const x = barrier % GRID_SIZE, y = Math.floor(barrier / GRID_SIZE);
      // Le brulage est place du cote feu de la ligne ; la cellule de coupure
      // reste intacte et continue de produire un delai de franchissement.
      const tx = x + backDx, ty = y + backDy;
      if (tx < 0 || ty < 0 || tx >= GRID_SIZE || ty >= GRID_SIZE) continue;
      const target = indexOf(tx, ty);
      if (!FUEL[sim.fuel[target]].nonBurnable && !Number.isFinite(sim.arrival[target])) sim.arrival[target] = sim.currentMinutes;
    }
  }
  sim.tacticalBurnsReady = true;
}
function constructPersistentLines(sim, deployments, bearing, elapsedMinutes) {
  if (!(elapsedMinutes > 0)) return;
  const front = frontCells(sim);
  if (!front.length) return;
  for (const unit of deployments || []) {
    const spec = APPLIANCES[unit.type];
    if (!spec || !spec.lineMetresPerHour || !Number.isFinite(unit.lng) || !Number.isFinite(unit.lat)) continue;
    const count = clamp(unit.count || 1, 1, 50);
    const autonomy = clamp(Number.isFinite(unit.autonomy) ? unit.autonomy / 100 : 1, 0.1, 1);
    const key = String(unit.id || `${unit.type}:${unit.lng}:${unit.lat}`);
    sim.lineProgressM[key] = (sim.lineProgressM[key] || 0) + spec.lineMetresPerHour * count * autonomy * elapsedMinutes / 60;
    const wanted = Math.floor(sim.lineProgressM[key] / CELL_METERS);
    const built = sim.lineCellsBuilt[key] || 0;
    if (wanted <= built) continue;
    const posted = cellForLngLat(unit.lng, unit.lat);
    let center = front[0], best = Infinity;
    for (const candidate of front) {
      const distance = Math.hypot(candidate[0] - posted.x, candidate[1] - posted.y);
      if (distance < best) { best = distance; center = candidate; }
    }
    // Ligne tangente a l'axe de propagation, construite alternativement de
    // chaque cote du point d'appui. Sa production est cumulative et durable.
    const tangentX = Math.cos(bearing * Math.PI / 180);
    const tangentY = Math.sin(bearing * Math.PI / 180);
    for (let ordinal = built; ordinal < wanted; ordinal += 1) {
      const signed = ordinal === 0 ? 0 : (ordinal % 2 ? 1 : -1) * Math.ceil(ordinal / 2);
      const x = Math.round(center[0] + tangentX * signed);
      const y = Math.round(center[1] + tangentY * signed);
      if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;
      const index = indexOf(x, y);
      sim.constructedBreak[index] = Math.max(sim.constructedBreak[index], spec.heavy ? 14 : 4);
      sim.heldBreak[index] = 1;
    }
    sim.lineCellsBuilt[key] = wanted;
  }
}
function buildSuppressionMask(deployments, input, sim) {
  const mask = new Float32Array(GRID_SIZE * GRID_SIZE);
  const front = sim ? frontCells(sim) : null;
  const totals = { deployedFlowLpm: 0, lineMetresPerHour: 0, appliances: 0, byType: {} };
  for (const unit of deployments || []) {
    if (!Number.isFinite(unit.lng) || !Number.isFinite(unit.lat)) continue;
    const spec = APPLIANCES[unit.type] || APPLIANCES.CCF;
    const count = clamp(unit.count || 1, 1, 50);
    // 100 % = engin frais ; en dessous, la logistique bride le debit tenu.
    const autonomy = clamp(Number.isFinite(unit.autonomy) ? unit.autonomy / 100 : 1, 0.1, 1);
    const flow = sustainedFlowLpm(unit.type) * count * autonomy;
    const line = (spec.lineMetresPerHour || 0) * count * autonomy;
    totals.deployedFlowLpm += flow; totals.lineMetresPerHour += line; totals.appliances += count;
    totals.byType[unit.type] = (totals.byType[unit.type] || 0) + count;

    const radius = unit.radiusM || 600;
    const radiusCells = Math.max(1, Math.ceil(radius / CELL_METERS));
    // Un engin pose a l'allumage ne resterait pas la pendant que le feu court
    // a vingt kilometres : il se reporte sur le front le plus proche de son
    // secteur. Sa position choisie determine donc QUEL flanc il traite.
    const posted = cellForLngLat(unit.lng, unit.lat);
    let center = posted;
    if (front && front.length) {
      let best = Infinity, nearest = null;
      for (const [fx, fy] of front) {
        const distance = Math.hypot(fx - posted.x, fy - posted.y) * CELL_METERS;
        if (distance < best) { best = distance; nearest = { x: fx, y: fy }; }
      }
      // Tant que le front reste dans son secteur, l'engin tient sa position :
      // c'est le choix de l'operateur qui decide du flanc traite. Il ne se
      // reporte que lorsque le feu lui a totalement echappe.
      if (nearest && best > radius) center = nearest;
    }
    // Le front couvert par cet engin, en metres : on repartit son debit dessus.
    const coveredMetres = Math.max(CELL_METERS, 2 * radius);
    const flowPerMetre = flow / coveredMetres;
    const linePerMetre = line / 60 / coveredMetres; // metres de ligne par minute et par metre de front

    for (let dy = -radiusCells; dy <= radiusCells; dy += 1) for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
      const x = center.x + dx, y = center.y + dy;
      if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;
      const distance = Math.hypot(dx, dy) * CELL_METERS;
      if (distance > radius) continue;
      const index = indexOf(x, y);

      const headRos = rothermelRateOfSpread(input, sim_fuelAt(index));
      const intensity = firelineIntensity(sim_fuelAt(index), headRos);
      if (intensity <= 0) continue;

      // Au-dela du seuil d'attaque directe, l'eau ne fait plus que ralentir.
      const ceiling = intensity > DIRECT_ATTACK_LIMIT_KW_M ? (spec.heavy ? 0.25 : 0.10)
        : intensity > HAND_ATTACK_LIMIT_KW_M ? (spec.heavy ? 0.92 : 0.70)
        : 0.98;

      const needed = requiredFlowPerMetre(intensity);
      const falloff = 1 - 0.45 * (distance / radius);
      const waterRatio = needed > 0 ? (flowPerMetre * falloff) / needed : 0;
      const lineRatio = intensity <= HAND_ATTACK_LIMIT_KW_M ? linePerMetre * falloff * 6 : 0;

      const effect = clamp((waterRatio + lineRatio) * ceiling, 0, ceiling);
      mask[index] = clamp(mask[index] + effect * (1 - mask[index]), 0, 0.985);
    }
  }
  return { mask, totals };
}
let SIM_FUEL = null;
function sim_fuelAt(index) { return SIM_FUEL ? SIM_FUEL[index] : 0; }

class MinHeap {
  constructor() { this.items = []; }
  push(item) { this.items.push(item); let i = this.items.length - 1; while (i > 0) { const p = Math.floor((i - 1) / 2); if (this.items[p].time <= item.time) break; this.items[i] = this.items[p]; i = p; } this.items[i] = item; }
  pop() { if (!this.items.length) return null; const root = this.items[0]; const tail = this.items.pop(); if (this.items.length && tail) { let i = 0; while (true) { let c = i * 2 + 1; if (c >= this.items.length) break; if (c + 1 < this.items.length && this.items[c + 1].time < this.items[c].time) c += 1; if (this.items[c].time >= tail.time) break; this.items[i] = this.items[c]; i = c; } this.items[i] = tail; } return root; }
}
const NEIGHBORS = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
/* ---------------------------------------------------------------------------
 * Sautes de feu (projection de braises).
 *
 * Un front de forte intensite projette des brandons en avant de lui : c'est ce
 * qui permet a un feu de franchir une piste, une route ou un pare-feu. Sans ce
 * mecanisme, un modele de proche-en-proche ne peut pas reproduire les grandes
 * journees de propagation -- ni un panache orageux (pyrocumulonimbus), qui
 * projette bien plus loin et plus souvent.
 *
 * Longueur de flamme : Byram. Portee : croissante avec la flamme et le vent.
 * Le tirage est deterministe (haché sur l'indice de cellule) pour qu'une meme
 * simulation redonne toujours le meme resultat.
 * ------------------------------------------------------------------------- */
const SPOT_MIN_INTENSITY_KW_M = 3000; // en deca, pas de brandon porteur
function spotNoise(index, salt) {
  let h = (Math.imul(index, 2654435761) + Math.imul(salt, 40503)) >>> 0;
  h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
  return h / 4294967296;
}
function spotFrom(sim, input, index, time, bearing, plume, heap) {
  const fuelCode = sim.fuel[index];
  const ros = rothermelRateOfSpread(input, fuelCode);
  const intensity = firelineIntensity(fuelCode, ros);
  // Comparaison inversee : NaN < seuil est faux, la garde laissait passer.
  if (!(intensity >= SPOT_MIN_INTENSITY_KW_M)) return 0;
  // Un panache orageux multiplie la frequence et la portee des projections.
  const rate = clamp((intensity - SPOT_MIN_INTENSITY_KW_M) / 20000, 0, 1) * 0.03 * plume; // ~3 % des cellules qui s allument projettent un brandon tenu
  if (spotNoise(index, 1) >= rate) return 0;
  const flameLength = 0.0775 * Math.pow(intensity, 0.46);
  const windKph = Math.max(1, input.windKph);
  const reach = 60 * flameLength * Math.pow(windKph / 10, 1.2) * plume;
  const distance = reach * (0.35 + 0.65 * spotNoise(index, 2));
  // Les brandons ne partent pas tous exactement dans l'axe du vent.
  const heading = bearing + (spotNoise(index, 3) - 0.5) * 50;
  const x = index % GRID_SIZE, y = Math.floor(index / GRID_SIZE);
  const tx = Math.round(x + Math.sin(heading * Math.PI / 180) * distance / CELL_METERS);
  const ty = Math.round(y - Math.cos(heading * Math.PI / 180) * distance / CELL_METERS);
  if (tx < 0 || ty < 0 || tx >= GRID_SIZE || ty >= GRID_SIZE) return 0;
  const target = indexOf(tx, ty);
  if (FUEL[sim.fuel[target]].nonBurnable) return 0;
  // Une braise n'allume que si le combustible est assez sec pour la recevoir.
  if (spotNoise(index, 4) > clamp(1 - input.moisture / 0.18, 0, 1)) return 0;
  const travel = distance / (windKph * 1000 / 60) + 2; // vol + delai d'allumage
  const arrival = time + travel;
  if (arrival >= sim.arrival[target]) return 0;
  sim.arrival[target] = arrival;
  heap.push({ index: target, time: arrival });
  return 1;
}
function spreadBearing(input) {
  if (Number.isFinite(input.windBearingDegrees)) return input.windBearingDegrees;
  const value = String(input.windDirection || '').toLowerCase();
  if (value.includes('nord-ouest')) return 135; if (value.includes('sud-ouest')) return 45; if (value.includes('nord-est')) return 225; if (value.includes('sud-est')) return 315;
  if (value.includes('ouest')) return 90; if (value.includes('est')) return 270; if (value.includes('nord')) return 180; if (value.includes('sud')) return 0; return 110;
}
/* Le raster stocke le cap de la plus forte montee. Rothermel applique son
 * terme de pente dans le sens de propagation : une pente locale ne peut donc
 * plus accelerer uniformement les huit voisins comme le faisait l'unique
 * slopeDegrees du domaine. */
function localFireInput(sim, index, dx, dy, input) {
  if (!sim.slope || !sim.slope[index]) return input;
  const heading = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  const upslope = sim.aspect ? sim.aspect[index] : heading;
  const difference = Math.abs(((heading - upslope + 540) % 360) - 180);
  const projectedSlope = sim.slope[index] * Math.max(0, Math.cos(difference * Math.PI / 180));
  return { ...input, slopeDegrees: projectedSlope };
}
function directionalFactor(dx, dy, bearing, lengthToBreadth) {
  const direction = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  const theta = ((direction - bearing + 540) % 360 - 180) * Math.PI / 180;
  // Huygens : le facteur doit valoir exactement 1 dans l'axe du vent. Un plancher sur le
  // denominateur ecraserait la tete de feu (0,35 au lieu de 1) et arrondirait l'ellipse ;
  // on borne donc l'excentricite elle-meme, jamais le denominateur.
  const eccentricity = Math.min(0.995, Math.sqrt(Math.max(0, 1 - 1 / (lengthToBreadth * lengthToBreadth))));
  return (1 - eccentricity) / (1 - eccentricity * Math.cos(theta));
}
function propagate(sim, input, targetMinutes) {
  SIM_FUEL = sim.fuel;
  const bearing = spreadBearing(input);
  installExplicitLines(sim, input);
  igniteTacticalBurns(sim, input, bearing);
  constructPersistentLines(sim, input.deployments, bearing, targetMinutes - sim.currentMinutes);
  const built = buildSuppressionMask(input.deployments, input, sim); const suppression = built.mask;
  built.totals.constructedLineM = [...sim.constructedBreak].filter((width) => width > 0).length * CELL_METERS;
  // Alexander doit recevoir le meme vent que Rothermel (mi-flamme, facteur 0,25).
  // Avec le vent brut on obtenait L/B ~ 6 : une ellipse plus fine qu'une cellule de 195 m,
  // que la grille ne peut pas representer -- la surface s'effondrait.
  // Rapport longueur/largeur : la relation lineaire bricolee ici donnait 2,1
  // a 28 km/h la ou Alexander (1985) donne 3,6. Un feu trop rond s'etale
  // lateralement bien plus qu'il ne devrait, ce qui gonfle enormement la
  // surface. On utilise la relation publiee, sur le vent a 10 m.
  const lengthToBreadth = clamp(1 + 8.729 * Math.pow(1 - Math.exp(-0.030 * Math.max(0, input.windKph)), 2.155), 1, 8); const heap = new MinHeap();
  // Panache orageux : phenomene observe a Saumos le 24 juillet 2026.
  const plume = input.plumeDriven ? 2.4 : 1;
  const spotting = input.spotting !== false;
  let spotFires = 0;
  for (let i = 0; i < sim.arrival.length; i += 1) if (sim.arrival[i] <= sim.currentMinutes && sim.state[i] !== 3) heap.push({ index: i, time: sim.arrival[i] });
  while (heap.items.length) {
    const current = heap.pop(); if (!current || current.time > targetMinutes) break; if (Math.abs(current.time - sim.arrival[current.index]) > 0.001) continue;
    if (sim.state[current.index] === 3) continue;
    // Une grande part de la bordure passe en combustion couvante lorsque la
    // couche limite se stabilise. Le hachage spatial conserve un resultat
    // deterministe et fait varier les portions actives d'une heure a l'autre.
    const activitySalt = Math.floor(current.time / 60) + 1709;
    if (spotNoise(current.index, activitySalt) > clamp(input.activeFraction || 1, NIGHT_ACTIVE_FRACTION, 1)) continue;
    if (spotting) spotFires += spotFrom(sim, input, current.index, current.time, bearing, plume, heap);
    const x = current.index % GRID_SIZE; const y = Math.floor(current.index / GRID_SIZE);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
      const next = indexOf(nx, ny); const headRos = rothermelRateOfSpread(localFireInput(sim, next, dx, dy, input), sim.fuel[next]); if (headRos <= 0) continue;
      const effectiveRos = headRos * directionalFactor(dx, dy, bearing, lengthToBreadth) * (1 - suppression[next]); if (effectiveRos <= 0) continue;
      // Piste, route ou debroussaillement : le front doit franchir la coupure.
      const width = breakWidthAt(sim, next);
      let crossing = 0;
      if (width > 0) {
        crossing = crossingDelayMinutes(width, firelineIntensity(sim.fuel[next], effectiveRos), effectiveRos, input.windKph, Boolean(sim.heldBreak[next]));
      }
      const arrivalTime = current.time + CELL_METERS * Math.hypot(dx, dy) / effectiveRos + crossing;
      if (arrivalTime < sim.arrival[next]) { sim.arrival[next] = arrivalTime; heap.push({ index: next, time: arrivalTime }); }
    }
  }
  sim.currentMinutes = targetMinutes; let affectedCells = 0; let burningCells = 0; let extinguishedEdgeCells = 0;
  for (let i = 0; i < sim.state.length; i += 1) {
    if (!(sim.arrival[i] <= targetMinutes)) { sim.state[i] = 0; continue; }
    affectedCells += 1;
    if (sim.state[i] === 3) { extinguishedEdgeCells += 1; continue; }
    sim.state[i] = targetMinutes - sim.arrival[i] < 12 ? 1 : 2;
    if (sim.state[i] === 1) burningCells += 1;
  }
  // Mort du perimetre : une bordure faible ne reste pas une source Dijkstra
  // eternelle. Le seuil de maintien reste tres sous les seuils operationnels
  // Byram/NWCG de 2 000 et 4 000 kW/m ; trois sous-pas evitent les bascules.
  for (const [x, y] of frontCells(sim)) {
    const index = indexOf(x, y);
    let ox = 0, oy = 0, exposed = 0;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
      const n = indexOf(nx, ny);
      if (!sim.state[n] && !FUEL[sim.fuel[n]].nonBurnable) { ox += dx; oy += dy; exposed += 1; }
    }
    if (!exposed) continue;
    const localRos = rothermelRateOfSpread(localFireInput(sim, index, ox, oy, input), sim.fuel[index]) * directionalFactor(ox, oy, bearing, lengthToBreadth);
    const intensity = firelineIntensity(sim.fuel[index], localRos);
    const direction = (Math.atan2(ox, -oy) * 180 / Math.PI + 360) % 360;
    const offset = Math.abs(((direction - bearing + 540) % 360) - 180);
    const wetRear = offset >= 120 && input.moisture >= 0.12;
    const treated = suppression[index] >= 0.82 && intensity <= DIRECT_ATTACK_LIMIT_KW_M;
    const weak = intensity < 500 || wetRear || treated;
    if (weak) {
      if (!Number.isFinite(sim.lowIntensitySince[index])) sim.lowIntensitySince[index] = targetMinutes;
      const requiredMinutes = treated ? 15 : wetRear ? 30 : 45;
      if (targetMinutes - sim.lowIntensitySince[index] + 15 >= requiredMinutes) {
        sim.state[index] = 3; extinguishedEdgeCells += 1;
      }
    } else sim.lowIntensitySince[index] = Infinity;
  }
  return { affectedCells, burningCells, extinguishedEdgeCells, lengthToBreadth, bearing, spotFires, suppressionTotals: built.totals, suppression };
}
/* ---------------------------------------------------------------------------
 * Geometrie : trace du contour reel.
 *
 * L'ancienne version emettait un rectangle par segment horizontal de chaque
 * ligne de la grille -- un feu apparaissait donc comme un empilement de
 * briques, et la couche de contour dessinait le bord de chacune. On suit
 * desormais la frontiere entre cellules brulees et intactes pour produire des
 * anneaux fermes (contour exterieur + trous), qu'on simplifie puis qu'on
 * lisse : une seule forme continue, comme un perimetre de feu reel.
 * ------------------------------------------------------------------------- */
const SIDES = [
  [0, -1, 0, 0, 1, 0], // voisin nord absent : arete (x,y) -> (x+1,y)
  [1, 0, 1, 0, 1, 1],  // voisin est absent  : arete (x+1,y) -> (x+1,y+1)
  [0, 1, 1, 1, 0, 1],  // voisin sud absent  : arete (x+1,y+1) -> (x,y+1)
  [-1, 0, 0, 1, 0, 0], // voisin ouest absent: arete (x,y+1) -> (x,y)
];
function traceRings(GRID, filled) {
  const key = (x, y) => x * (GRID + 1) + y;
  const outgoing = new Map();
  for (let y = 0; y < GRID; y += 1) for (let x = 0; x < GRID; x += 1) {
    if (!filled(x, y)) continue;
    for (const [nx, ny, ax, ay, bx, by] of SIDES) {
      const px = x + nx, py = y + ny;
      const neighbourFilled = px >= 0 && py >= 0 && px < GRID && py < GRID && filled(px, py);
      if (neighbourFilled) continue;
      const from = key(x + ax, y + ay), to = [x + bx, y + by];
      const list = outgoing.get(from);
      if (list) list.push(to); else outgoing.set(from, [to]);
    }
  }
  const rings = [];
  for (const [start] of outgoing) {
    while (true) {
      const first = outgoing.get(start);
      if (!first || !first.length) break;
      const ring = [];
      let point = [Math.floor(start / (GRID + 1)), start % (GRID + 1)];
      while (true) {
        const list = outgoing.get(key(point[0], point[1]));
        if (!list || !list.length) break;
        const next = list.pop();
        ring.push(point);
        point = next;
        if (key(point[0], point[1]) === start) break;
      }
      if (ring.length >= 4) rings.push(ring);
    }
  }
  return rings;
}
// Aire signee (shoelace). Positive = contour exterieur, negative = trou.
function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}
// Ramer-Douglas-Peucker : supprime l'escalier de la grille avant lissage.
function simplifyRing(ring, epsilon) {
  if (ring.length < 4) return ring;
  const keep = new Uint8Array(ring.length); keep[0] = 1; keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    if (last <= first + 1) continue;
    const ax = ring[first][0], ay = ring[first][1];
    const bx = ring[last][0], by = ring[last][1];
    const dx = bx - ax, dy = by - ay;
    const norm = Math.hypot(dx, dy) || 1;
    let worst = -1, worstIndex = -1;
    for (let i = first + 1; i < last; i += 1) {
      const distance = Math.abs((ring[i][0] - ax) * dy - (ring[i][1] - ay) * dx) / norm;
      if (distance > worst) { worst = distance; worstIndex = i; }
    }
    if (worst > epsilon && worstIndex > 0) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }
  const out = [];
  for (let i = 0; i < ring.length; i += 1) if (keep[i]) out.push(ring[i]);
  return out.length >= 3 ? out : ring;
}
// Chaikin : arrondit les angles restants, sans deformer la surface.
function smoothRing(ring, iterations) {
  let points = ring;
  for (let pass = 0; pass < iterations; pass += 1) {
    if (points.length < 3) break;
    const out = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i], b = points[(i + 1) % points.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    points = out;
  }
  return points;
}
function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/* Convertit les anneaux traces en Polygon/MultiPolygon lisses en lng/lat. */
function ringsToGeoJSON(filled) {
  const rings = traceRings(GRID_SIZE, filled);
  const outers = [], holes = [];
  for (const ring of rings) {
    const area = ringArea(ring);
    // Les taches d'une seule cellule sont du bruit de grille : on les ecarte.
    if (Math.abs(area) < 0.75) continue;
    // Un petit foyer ne compte que quelques cellules : simplifier fort lui
    // ferait perdre sa surface. On adoucit le traitement a mesure qu il est petit.
    const small = ring.length < 32;
    const shaped = smoothRing(simplifyRing(ring, small ? 0.3 : 0.75), small ? 1 : 2);
    (area > 0 ? outers : holes).push({ grid: shaped, area: Math.abs(area) });
  }
  if (!outers.length) return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } };
  const toLngLat = (point) => [
    BOUNDS.west + (point[0] / GRID_SIZE) * (BOUNDS.east - BOUNDS.west),
    BOUNDS.north - (point[1] / GRID_SIZE) * (BOUNDS.north - BOUNDS.south),
  ];
  const close = (ring) => { const out = ring.map(toLngLat); out.push(out[0]); return out; };
  outers.sort((a, b) => b.area - a.area);
  const polygons = outers.map((outer) => [close(outer.grid)]);
  for (const hole of holes) {
    const probe = hole.grid[0];
    const index = outers.findIndex((outer) => pointInRing(probe, outer.grid));
    if (index >= 0) polygons[index].push(close(hole.grid));
  }
  return polygons.length === 1
    ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: polygons[0] } }
    : { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polygons } };
}
function perimeterGeoJSON(sim) {
  const feature = ringsToGeoJSON((x, y) => sim.state[indexOf(x, y)] > 0);
  feature.properties = { source: 'FireNow cellular simulation', layer: 'perimetre' };
  return feature;
}
// Bande en flammes : cellules encore dans leur temps de residence.
function activeFrontGeoJSON(sim) {
  const feature = ringsToGeoJSON((x, y) => sim.state[indexOf(x, y)] === 1);
  feature.properties = { source: 'FireNow cellular simulation', layer: 'front-actif' };
  return feature;
}
function extinguishedEdgeGeoJSON(sim) {
  const feature = ringsToGeoJSON((x, y) => sim.state[indexOf(x, y)] === 3);
  feature.properties = { source: 'FireNow cellular simulation', layer: 'lisiere-eteinte' };
  return feature;
}
function cloneState(sim){return{state:sim.state.slice(),arrival:sim.arrival.slice(),lowIntensitySince:sim.lowIntensitySince.slice(),constructedBreak:sim.constructedBreak.slice(),heldBreak:sim.heldBreak.slice(),lineProgressM:{...sim.lineProgressM},lineCellsBuilt:{...sim.lineCellsBuilt},explicitLinesReady:sim.explicitLinesReady,tacticalBurnsReady:sim.tacticalBurnsReady,fuel:sim.fuel.slice(),currentMinutes:sim.currentMinutes,ignition:sim.ignition,extraIgnitions:sim.extraIgnitions,infra:sim.infra,people:sim.people,network:sim.network,slope:sim.slope,aspect:sim.aspect,landscapeSources:sim.landscapeSources,landscapeAppliedCells:sim.landscapeAppliedCells};}
/* ---------------------------------------------------------------------------
 * Analyse du front.
 *
 * L'ancienne version mesurait la longueur du perimetre puis lui appliquait
 * l'intensite de TETE sur toute sa longueur. Elle exigeait donc de tenir
 * l'arriere du feu -- qui recule contre le vent et s'eteint presque seul --
 * au meme debit que la tete. D'ou des besoins en eau absurdes (des centaines
 * de milliers de litres par minute) sans rapport avec la realite operationnelle.
 *
 * Ici chaque cellule de bordure est evaluee selon SA direction : l'ellipse
 * d'Alexander donne la vitesse locale, Byram l'intensite locale, et le besoin
 * en eau est la somme des besoins locaux.
 * ------------------------------------------------------------------------- */
function analyseFront(sim, input, lengthToBreadth, bearing) {
  let totalM = 0, requiredLpm = 0, weightedIntensity = 0, peakIntensity = 0;
  let headM = 0, flankM = 0, rearM = 0;
  for (let y = 0; y < GRID_SIZE; y += 1) for (let x = 0; x < GRID_SIZE; x += 1) {
    const index = indexOf(x, y);
    if (!sim.state[index] || sim.state[index] === 3) continue;
    // Normale sortante : moyenne des directions vers le combustible intact.
    let ox = 0, oy = 0, exposed = 0;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
      const neighbour = indexOf(nx, ny);
      if (sim.state[neighbour] || FUEL[sim.fuel[neighbour]].nonBurnable) continue;
      ox += dx; oy += dy; exposed += 1;
    }
    if (!exposed) continue;
    const headRos = rothermelRateOfSpread(localFireInput(sim, index, ox, oy, input), sim.fuel[index]);
    if (headRos <= 0) continue;
    const localRos = headRos * directionalFactor(ox, oy, bearing, lengthToBreadth);
    const intensity = firelineIntensity(sim.fuel[index], localRos);
    const segment = CELL_METERS;
    totalM += segment;
    requiredLpm += requiredFlowPerMetre(intensity) * segment;
    weightedIntensity += intensity * segment;
    if (intensity > peakIntensity) peakIntensity = intensity;
    // Secteur du front, mesure entre la normale sortante et le cap du vent.
    const direction = (Math.atan2(ox, -oy) * 180 / Math.PI + 360) % 360;
    const offset = Math.abs(((direction - bearing + 540) % 360) - 180);
    if (offset < 60) headM += segment; else if (offset < 120) flankM += segment; else rearM += segment;
  }
  return {
    totalM, requiredLpm, peakIntensity,
    meanIntensity: totalM > 0 ? weightedIntensity / totalM : 0,
    headM, flankM, rearM,
  };
}
/* Part de chaque espece reellement presente sur la grille simulee. */
function fuelComposition(mask) {
  const counts = new Map();
  for (const code of mask) counts.set(code, (counts.get(code) || 0) + 1);
  const total = mask.length;
  return [...counts.entries()]
    .map(([code, n]) => ({
      code, nom: (FUEL[code] || {}).name || '?', strate: (FUEL[code] || {}).strate || '—',
      model: (FUEL[code] || {}).model || '—', part: Number((n / total).toFixed(4)),
    }))
    .sort((a, b) => b.part - a.part);
}
/* Enjeux atteints et menaces : ce que le feu a deja pris, et ce qui est
 * encore devant lui. Sans cela l'operateur ne voit qu'une surface. */
function humanExposure(sim) {
  if (!sim.infra) return null;
  const cellHa = (CELL_METERS * CELL_METERS) / 10000;
  let burntPeople = 0, threatenedPeople = 0, builtCellsBurnt = 0, trackKm = 0, roadKm = 0;
  const reachM = 1500; // distance sous laquelle un enjeu est directement menace
  const reachCells = Math.max(1, Math.round(reachM / CELL_METERS));
  for (let y = 0; y < GRID_SIZE; y += 1) for (let x = 0; x < GRID_SIZE; x += 1) {
    const index = indexOf(x, y);
    const flags = sim.infra[index];
    if (!flags) continue;
    const burnt = sim.state[index] > 0;
    if (burnt) {
      if (flags & INFRA_BUILT) { builtCellsBurnt += 1; burntPeople += sim.people[index]; }
      if (flags & INFRA_TRACK) trackKm += CELL_METERS / 1000;
      if (flags & INFRA_ROAD) roadKm += CELL_METERS / 1000;
      continue;
    }
    if (!(flags & INFRA_BUILT) || !sim.people[index]) continue;
    // Menace : du feu actif dans le voisinage immediat.
    let near = false;
    for (let dy = -reachCells; dy <= reachCells && !near; dy += 1) for (let dx = -reachCells; dx <= reachCells; dx += 1) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
      if (sim.state[indexOf(nx, ny)] > 0) { near = true; break; }
    }
    if (near) threatenedPeople += sim.people[index];
  }
  return {
    populationAtteinte: Math.round(burntPeople),
    populationMenacee: Math.round(threatenedPeople),
    surfaceBatieHa: Number((builtCellsBurnt * cellHa).toFixed(1)),
    pistesCoupeesKm: Number(trackKm.toFixed(1)),
    routesCoupeesKm: Number(roadKm.toFixed(1)),
  };
}
function resultFor(sim, input, spread) {
  const headRos = rothermelRateOfSpread(input, 0);
  const front = analyseFront(sim, input, spread.lengthToBreadth, spread.bearing);
  const totals = spread.suppressionTotals || { deployedFlowLpm: 0, lineMetresPerHour: 0, appliances: 0, byType: {} };
  const perimetreM = front.totalM;
  const requiredFlowLpm = front.requiredLpm;
  // Le mode d'attaque se decide sur l'intensite de TETE : c'est elle qui
  // interdit ou non l'attaque directe, pas la moyenne du perimetre.
  const headIntensity = front.peakIntensity;
  const attackViable = headIntensity <= DIRECT_ATTACK_LIMIT_KW_M;
  const containmentRatio = requiredFlowLpm > 0 ? totals.deployedFlowLpm / requiredFlowLpm : (perimetreM === 0 ? 1 : 0);

  // Maitrise : le debit excedentaire eteint du front, pendant que le feu en
  // cree du nouveau. On ne maitrise que si le solde est positif.
  const meanRequiredPerMetre = perimetreM > 0 ? requiredFlowLpm / perimetreM : 0;
  const surplus = totals.deployedFlowLpm - requiredFlowLpm;
  const knockdownMetresPerMin = meanRequiredPerMetre > 0 ? surplus / meanRequiredPerMetre : 0;
  const lineMetresPerMin = totals.lineMetresPerHour / 60;
  const growthMetresPerMin = Math.PI * headRos / Math.max(1, spread.lengthToBreadth);
  const netMetresPerMin = knockdownMetresPerMin + (attackViable ? lineMetresPerMin : 0) - growthMetresPerMin;
  const containmentMinutes = perimetreM === 0 ? 0
    : (attackViable && netMetresPerMin > 0 ? Math.max(5, Math.round(perimetreM / netMetresPerMin)) : null);
  const litresUsedPerHour = Math.round(Math.min(totals.deployedFlowLpm, Math.max(requiredFlowLpm, 0)) * 60);

  return {
    model: 'Rothermel 1972 cellular grid', shape: 'Alexander 1985 directional ellipse',
    gridSize: GRID_SIZE, gridMeters: Number(CELL_METERS.toFixed(2)), boxMetres: BOX_METERS,
    ignition: sim.ignition || IGNITION, extraIgnitions: sim.extraIgnitions || [], bounds: BOUNDS, simulationMinutes: sim.currentMinutes,
    rateOfSpreadMetersPerMinute: Number(headRos.toFixed(2)),
    fuelMoisture: Number(input.moisture.toFixed(3)),
    region: (input.terrain && input.terrain.region) || 'gironde',
    exposure: humanExposure(sim),
    network: sim.network ? sim.network.label : null,
    landscape: sim.landscapeSources ? { sources: sim.landscapeSources, appliedCells: sim.landscapeAppliedCells } : null,
    fuelComposition: fuelComposition(sim.fuel),
    lengthToBreadth: Number(spread.lengthToBreadth.toFixed(2)),
    totalBurnedHa: Number((spread.affectedCells * CELL_METERS * CELL_METERS / 10000).toFixed(2)),
    affectedCells: spread.affectedCells, burningCells: spread.burningCells, extinguishedEdgeCells: spread.extinguishedEdgeCells || 0, spotFires: spread.spotFires || 0,
    suppression: {
      firelineIntensityKwM: Math.round(headIntensity),
      meanIntensityKwM: Math.round(front.meanIntensity),
      activePerimeterM: Math.round(perimetreM),
      headM: Math.round(front.headM), flankM: Math.round(front.flankM), rearM: Math.round(front.rearM),
      requiredFlowLpm: Math.round(requiredFlowLpm),
      deployedFlowLpm: Math.round(totals.deployedFlowLpm),
      containmentRatio: Number(containmentRatio.toFixed(2)),
      containmentMinutes,
      litresPerHour: litresUsedPerHour,
      attackViable,
      status: perimetreM === 0 ? 'eteint' : containmentMinutes !== null ? 'maitrise' : containmentRatio >= 0.6 ? 'contenu' : 'libre',
      attackMode: headIntensity > DIRECT_ATTACK_LIMIT_KW_M ? 'indirect'
        : headIntensity > HAND_ATTACK_LIMIT_KW_M ? 'moyens-lourds' : 'directe',
      appliances: totals.appliances, byType: totals.byType,
      lineMetresPerHour: Math.round(totals.lineMetresPerHour),
      constructedLineM: Math.round(totals.constructedLineM || 0),
    },
    perimeterGeoJSON: perimeterGeoJSON(sim),
    activeFrontGeoJSON: activeFrontGeoJSON(sim),
    extinguishedEdgeGeoJSON: extinguishedEdgeGeoJSON(sim),
  };
}
let scenario=null;
function simulate(input){input={...input};
// Changer de domaine invalide la grille persistante : on repart du foyer.
const key=configureDomain(input.domain);const domainChanged=key!==DOMAIN_KEY;DOMAIN_KEY=key;if(domainChanged)scenario=null;
const independent=Boolean(input.independent);const sim=independent||input.reset||!scenario?createState({...(input.ignitionLngLat||{}),extraIgnitions:input.extraIgnitions,terrain:input.terrain,landscape:input.landscape}):scenario;const target=Number.isFinite(input.targetMinutes)?Math.max(0,input.targetMinutes):sim.currentMinutes+clamp(input.minutes||0,0,1440);// Avancer d'un bloc figerait les moyens sur le front du debut de pas. On
// decoupe pour qu'ils se reportent au fur et a mesure, comme sur le terrain.
const STEP=15;let spread,lastEnvironment=environmentAt(input,sim.currentMinutes);{let cursor=sim.currentMinutes;do{cursor=Math.min(target,cursor+STEP);lastEnvironment=environmentAt(input,cursor);spread=propagate(sim,lastEnvironment,cursor);}while(cursor<target);}if(!independent)scenario=sim;const result=resultFor(sim,lastEnvironment,spread);result.diurnal={hourOfDay:Number(lastEnvironment.hourOfDay.toFixed(2)),daylightFactor:Number(lastEnvironment.daylightFactor.toFixed(3)),wafScale:Number(lastEnvironment.wafScale.toFixed(3)),activeFraction:Number(lastEnvironment.activeFraction.toFixed(3))};if(input.includeForecast){const forecast=cloneState(sim);let projected=spread,forecastCursor=target,forecastEnvironment=lastEnvironment;while(forecastCursor<target+180){forecastCursor=Math.min(target+180,forecastCursor+STEP);forecastEnvironment=environmentAt(input,forecastCursor);projected=propagate(forecast,forecastEnvironment,forecastCursor);}result.forecastPerimeterGeoJSON=perimeterGeoJSON(forecast);result.forecastMinutes=target+180;result.forecastBurnedHa=Number((projected.affectedCells*CELL_METERS*CELL_METERS/10000).toFixed(2));}return result;}
self.__firenowTest={buildInfrastructure,decodeLandscape,landscapeIndexAt,localFireInput,NETWORKS,INFRA_TRACK,INFRA_ROAD,INFRA_BUILT,speciesAt,cellForLngLat,lngLatForCell,APPLIANCES,SPECIES,FUEL_MODELS,REGIONS,speciesMix,generateFuelMask,simulate,rothermelRateOfSpread,deriveMoisture,environmentAt,daylightProfile,firelineIntensity,sustainedFlowLpm,crossingDelayMinutes,APPLIANCES,GRID_SIZE,configureDomain,get IGNITION(){return IGNITION;},get CELL_METERS(){return CELL_METERS;}};
self.onmessage=(event)=>{const message=event.data||{};try{self.postMessage({id:message.id,ok:true,result:simulate(message)});}catch(error){self.postMessage({id:message.id,ok:false,error:error instanceof Error?error.message:'Simulation worker error'});}};
