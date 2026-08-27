/* FireOps local wildfire engine: Rothermel (1972), Alexander (1985), 128 x 128 cellular grid. */
const GRID_SIZE = 128;
const BOX_METERS = 25000;
const CELL_METERS = BOX_METERS / GRID_SIZE;
const IGNITION = { lng: -0.4540519, lat: 44.5897472 };
const LAT_DEGREES = BOX_METERS / 111320;
const LNG_DEGREES = BOX_METERS / (111320 * Math.cos(IGNITION.lat * Math.PI / 180));
const BOUNDS = { west: IGNITION.lng - LNG_DEGREES / 2, east: IGNITION.lng + LNG_DEGREES / 2, south: IGNITION.lat - LAT_DEGREES / 2, north: IGNITION.lat + LAT_DEGREES / 2 };
const FUEL = {
  0: { name: 'pin-dense', load: 0.071, depth: 0.60, savr: 1800, moistureExtinction: 0.25, multiplier: 2.1 },
  1: { name: 'pin-clair', load: 0.050, depth: 0.52, savr: 1700, moistureExtinction: 0.25, multiplier: 1.65 },
  2: { name: 'coupe-rase', load: 0.031, depth: 0.32, savr: 1500, moistureExtinction: 0.22, multiplier: 0.55 },
  3: { name: 'agricole', load: 0.018, depth: 0.25, savr: 1900, moistureExtinction: 0.18, multiplier: 0.34 },
  4: { name: 'urbain', nonBurnable: true },
  5: { name: 'eau', nonBurnable: true },
};
const MIDFLAME_FACTOR = 0.25; // vent a mi-flamme sous couvert de pin maritime
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const indexOf = (x, y) => y * GRID_SIZE + x;

function rothermelRateOfSpread(input, fuelCode = 0) {
  const fuel = FUEL[fuelCode] || FUEL[0];
  if (fuel.nonBurnable) return 0;
  const sigma = fuel.savr;
  const beta = clamp(fuel.load / (fuel.depth * 32), 0.001, 0.12);
  const betaOpt = 3.348 * Math.pow(sigma, -0.8189);
  const ratio = beta / betaOpt;
  const exponentA = 133 * Math.pow(sigma, -0.7913);
  const gammaMax = Math.pow(sigma, 1.5) / (495 + 0.0594 * Math.pow(sigma, 1.5));
  const gamma = gammaMax * Math.pow(ratio, exponentA) * Math.exp(exponentA * (1 - ratio));
  const moistureRatio = clamp(input.moisture / fuel.moistureExtinction, 0, 1.5);
  const moistureDamping = clamp(1 - 2.59 * moistureRatio + 5.11 * moistureRatio ** 2 - 3.52 * moistureRatio ** 3, 0, 1);
  const mineralDamping = 0.174 * Math.pow(0.01, -0.19);
  const netFuelLoad = fuel.load * (1 - 0.0555);
  const reactionIntensity = gamma * netFuelLoad * 8000 * moistureDamping * mineralDamping;
  const windMph = input.windKph * 0.621371;
  const midflameFpm = windMph * 88 * MIDFLAME_FACTOR;
  const windC = 7.47 * Math.exp(-0.133 * Math.pow(sigma, 0.55));
  const windB = 0.02526 * Math.pow(sigma, 0.54);
  const windE = 0.715 * Math.exp(-3.59e-4 * sigma);
  const windFactor = windC * Math.pow(Math.max(0, midflameFpm), windB) * Math.pow(ratio, -windE);
  const slopeFactor = 5.275 * Math.pow(beta, -0.3) * Math.tan((input.slopeDegrees * Math.PI) / 180) ** 2;
  const propagatingFlux = Math.exp((0.792 + 0.681 * Math.sqrt(sigma)) * (beta + 0.1)) / (192 + 0.2595 * sigma);
  const effectiveHeating = Math.exp(-138 / sigma);
  const heatOfPreignition = 250 + 1116 * input.moisture;
  const bulkDensity = fuel.load / fuel.depth;
  const feetPerMinute = (reactionIntensity * propagatingFlux * (1 + windFactor + slopeFactor)) / Math.max(0.001, bulkDensity * effectiveHeating * heatOfPreignition);
  return Math.max(0, feetPerMinute * 0.3048 * fuel.multiplier);
}

function generateFuelMask() {
  const mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
  for (let y = 0; y < GRID_SIZE; y += 1) for (let x = 0; x < GRID_SIZE; x += 1) {
    const nx = x / (GRID_SIZE - 1); const ny = y / (GRID_SIZE - 1);
    let code = ((x * 17 + y * 31) % 29 < 6) ? 1 : 0;
    if ((x + 2 * y) % 47 < 3 || (x > 86 && y > 61)) code = 2;
    if (x > 99 || (x > 78 && y < 26)) code = 3;
    if (((nx - 0.66) / 0.055) ** 2 + ((ny - 0.40) / 0.045) ** 2 < 1 || ((nx - 0.31) / 0.042) ** 2 + ((ny - 0.50) / 0.038) ** 2 < 1) code = 4;
    if (Math.abs(nx - (0.13 + 0.035 * Math.sin(ny * 15))) < 0.008 && y > 16) code = 5;
    mask[indexOf(x, y)] = code;
  }
  return mask;
}
function createState(origin) {
  const state = new Uint8Array(GRID_SIZE * GRID_SIZE);
  const arrival = new Float32Array(GRID_SIZE * GRID_SIZE); arrival.fill(Infinity);
  const fuel = generateFuelMask();
  const point = origin && Number.isFinite(origin.lng) && Number.isFinite(origin.lat)
    ? cellForLngLat(origin.lng, origin.lat)
    : { x: Math.floor(GRID_SIZE / 2), y: Math.floor(GRID_SIZE / 2) };
  // Un allumage sur une cellule non combustible ne partirait jamais : on glisse vers la plus proche cellule qui brule.
  let cell = point;
  if (FUEL[fuel[indexOf(cell.x, cell.y)]].nonBurnable) {
    search: for (let radius = 1; radius < GRID_SIZE; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
        const x = point.x + dx, y = point.y + dy;
        if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;
        if (!FUEL[fuel[indexOf(x, y)]].nonBurnable) { cell = { x, y }; break search; }
      }
    }
  }
  // Un foyer initial peut couvrir un disque : l'operateur regle sa taille en glissant
  // sur la carte, plutot que via un champ numerique.
  const radius = Math.max(0, Number(origin && origin.radiusM) || 0);
  const reach = Math.min(GRID_SIZE, Math.ceil(radius / CELL_METERS));
  let seeded = 0;
  for (let dy = -reach; dy <= reach; dy += 1) for (let dx = -reach; dx <= reach; dx += 1) {
    const x = cell.x + dx, y = cell.y + dy;
    if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;
    if (Math.hypot(dx, dy) * CELL_METERS > radius) continue;
    if (FUEL[fuel[indexOf(x, y)]].nonBurnable) continue;
    arrival[indexOf(x, y)] = 0; seeded += 1;
  }
  if (!seeded) arrival[indexOf(cell.x, cell.y)] = 0;
  const [lng, lat] = lngLatForCell(cell.x, cell.y);
  return { state, arrival, fuel, currentMinutes: 0, ignition: { lng, lat, radiusM: radius } };
}
function lngLatForCell(x, y) { return [BOUNDS.west + ((x + 0.5) / GRID_SIZE) * (BOUNDS.east - BOUNDS.west), BOUNDS.north - ((y + 0.5) / GRID_SIZE) * (BOUNDS.north - BOUNDS.south)]; }
function cellForLngLat(lng, lat) { return { x: clamp(Math.floor(((lng - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * GRID_SIZE), 0, GRID_SIZE - 1), y: clamp(Math.floor(((BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south)) * GRID_SIZE), 0, GRID_SIZE - 1) }; }
function buildSuppressionMask(deployments) {
  const mask = new Float32Array(GRID_SIZE * GRID_SIZE);
  for (const unit of deployments || []) {
    if (!Number.isFinite(unit.lng) || !Number.isFinite(unit.lat)) continue;
    const center = cellForLngLat(unit.lng, unit.lat);
    const radius = unit.radiusM || 600; const radiusCells = Math.max(1, Math.ceil(radius / CELL_METERS));
    const perUnit = clamp(unit.capacity || 0.045, 0, 0.35); const combined = 1 - Math.pow(1 - perUnit, clamp(unit.count || 1, 1, 50));
    for (let dy = -radiusCells; dy <= radiusCells; dy += 1) for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
      const x = center.x + dx; const y = center.y + dy; if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;
      const distance = Math.hypot(dx, dy) * CELL_METERS; if (distance > radius) continue;
      const index = indexOf(x, y); const falloff = 1 - distance / radius;
      mask[index] = Math.max(mask[index], clamp(combined * (0.45 + 0.55 * falloff), 0, 0.92));
    }
  }
  return mask;
}
class MinHeap {
  constructor() { this.items = []; }
  push(item) { this.items.push(item); let i = this.items.length - 1; while (i > 0) { const p = Math.floor((i - 1) / 2); if (this.items[p].time <= item.time) break; this.items[i] = this.items[p]; i = p; } this.items[i] = item; }
  pop() { if (!this.items.length) return null; const root = this.items[0]; const tail = this.items.pop(); if (this.items.length && tail) { let i = 0; while (true) { let c = i * 2 + 1; if (c >= this.items.length) break; if (c + 1 < this.items.length && this.items[c + 1].time < this.items[c].time) c += 1; if (this.items[c].time >= tail.time) break; this.items[i] = this.items[c]; i = c; } this.items[i] = tail; } return root; }
}
const NEIGHBORS = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
function spreadBearing(input) {
  if (Number.isFinite(input.windBearingDegrees)) return input.windBearingDegrees;
  const value = String(input.windDirection || '').toLowerCase();
  if (value.includes('nord-ouest')) return 135; if (value.includes('sud-ouest')) return 45; if (value.includes('nord-est')) return 225; if (value.includes('sud-est')) return 315;
  if (value.includes('ouest')) return 90; if (value.includes('est')) return 270; if (value.includes('nord')) return 180; if (value.includes('sud')) return 0; return 110;
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
  const suppression = buildSuppressionMask(input.deployments); const bearing = spreadBearing(input);
  // Alexander doit recevoir le meme vent que Rothermel (mi-flamme, facteur 0,25).
  // Avec le vent brut on obtenait L/B ~ 6 : une ellipse plus fine qu'une cellule de 195 m,
  // que la grille ne peut pas representer -- la surface s'effondrait.
  const lengthToBreadth = clamp(1 + 0.25 * input.windKph * 0.621371 * MIDFLAME_FACTOR, 1, 8); const heap = new MinHeap();
  for (let i = 0; i < sim.arrival.length; i += 1) if (sim.arrival[i] <= sim.currentMinutes) heap.push({ index: i, time: sim.arrival[i] });
  while (heap.items.length) {
    const current = heap.pop(); if (!current || current.time > targetMinutes) break; if (Math.abs(current.time - sim.arrival[current.index]) > 0.001) continue;
    const x = current.index % GRID_SIZE; const y = Math.floor(current.index / GRID_SIZE);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
      const next = indexOf(nx, ny); const headRos = rothermelRateOfSpread(input, sim.fuel[next]); if (headRos <= 0) continue;
      const effectiveRos = headRos * directionalFactor(dx, dy, bearing, lengthToBreadth) * (1 - suppression[next]); if (effectiveRos <= 0) continue;
      const arrivalTime = current.time + CELL_METERS * Math.hypot(dx, dy) / effectiveRos;
      if (arrivalTime < sim.arrival[next]) { sim.arrival[next] = arrivalTime; heap.push({ index: next, time: arrivalTime }); }
    }
  }
  sim.currentMinutes = targetMinutes; let affectedCells = 0; let burningCells = 0;
  for (let i = 0; i < sim.state.length; i += 1) { if (sim.arrival[i] <= targetMinutes) { sim.state[i] = targetMinutes - sim.arrival[i] < 12 ? 1 : 2; affectedCells += 1; if (sim.state[i] === 1) burningCells += 1; } else sim.state[i] = 0; }
  return { affectedCells, burningCells, lengthToBreadth };
}
function perimeterGeoJSON(sim) {
  const spanLng = (BOUNDS.east - BOUNDS.west) / GRID_SIZE;
  const spanLat = (BOUNDS.north - BOUNDS.south) / GRID_SIZE;
  const polygons = [];
  for (let y = 0; y < GRID_SIZE; y += 1) {
    let runStart = -1;
    for (let x = 0; x <= GRID_SIZE; x += 1) {
      const burnt = x < GRID_SIZE && sim.state[indexOf(x, y)] > 0;
      if (burnt && runStart < 0) runStart = x;
      if (!burnt && runStart >= 0) {
        const west = BOUNDS.west + runStart * spanLng;
        const east = BOUNDS.west + x * spanLng;
        const north = BOUNDS.north - y * spanLat;
        const south = BOUNDS.north - (y + 1) * spanLat;
        polygons.push([[[west, north], [east, north], [east, south], [west, south], [west, north]]]);
        runStart = -1;
      }
    }
  }
  return { type: 'Feature', properties: { source: 'FireOps cellular simulation' }, geometry: { type: 'MultiPolygon', coordinates: polygons } };
}
function cloneState(sim){return{state:sim.state.slice(),arrival:sim.arrival.slice(),fuel:sim.fuel.slice(),currentMinutes:sim.currentMinutes,ignition:sim.ignition};}
function resultFor(sim,input,spread){const headRos=rothermelRateOfSpread(input,0);return{model:'Rothermel 1972 cellular grid',shape:'Alexander 1985 directional ellipse',gridSize:GRID_SIZE,gridMeters:Number(CELL_METERS.toFixed(2)),ignition:sim.ignition||IGNITION,bounds:BOUNDS,simulationMinutes:sim.currentMinutes,rateOfSpreadMetersPerMinute:Number(headRos.toFixed(2)),lengthToBreadth:Number(spread.lengthToBreadth.toFixed(2)),totalBurnedHa:Number((spread.affectedCells*CELL_METERS*CELL_METERS/10000).toFixed(2)),affectedCells:spread.affectedCells,burningCells:spread.burningCells,perimeterGeoJSON:perimeterGeoJSON(sim)};}
let scenario=null;
function simulate(input){const independent=Boolean(input.independent);const sim=independent||input.reset||!scenario?createState(input.ignitionLngLat):scenario;const target=Number.isFinite(input.targetMinutes)?Math.max(0,input.targetMinutes):sim.currentMinutes+clamp(input.minutes||0,0,1440);const spread=propagate(sim,input,target);if(!independent)scenario=sim;const result=resultFor(sim,input,spread);if(input.includeForecast){const forecast=cloneState(sim);const projected=propagate(forecast,input,target+180);result.forecastPerimeterGeoJSON=perimeterGeoJSON(forecast);result.forecastMinutes=target+180;result.forecastBurnedHa=Number((projected.affectedCells*CELL_METERS*CELL_METERS/10000).toFixed(2));}return result;}
self.__fireopsTest={simulate,rothermelRateOfSpread,IGNITION,GRID_SIZE,CELL_METERS};
self.onmessage=(event)=>{const message=event.data||{};try{self.postMessage({id:message.id,ok:true,result:simulate(message)});}catch(error){self.postMessage({id:message.id,ok:false,error:error instanceof Error?error.message:'Simulation worker error'});}};
