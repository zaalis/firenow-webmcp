import fs from 'node:fs';
import readline from 'node:readline';

const GRID = 128;
const ELEVATION_GRID = 32;
const BOUNDS = { west: -1.416, east: -0.784, south: 44.575, north: 45.025 };
const inseeArgument = process.argv.find((value) => value.startsWith('--insee-csv='));
if (!inseeArgument) throw new Error('Usage: node scripts/build-gironde-landscape.mjs --insee-csv=<carreaux_200m_met.csv>');
const inseePath = inseeArgument.slice('--insee-csv='.length);

const fuel = new Uint8Array(GRID * GRID); fuel.fill(255);
const infra = new Uint8Array(GRID * GRID);
const people10 = new Uint16Array(GRID * GRID);
const slope = new Uint8Array(GRID * GRID);
const aspect = new Uint8Array(GRID * GRID);
const indexOf = (x, y) => y * GRID + x;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const cellFor = (lng, lat) => ({
  x: Math.max(0, Math.min(GRID - 1, Math.floor((lng - BOUNDS.west) / (BOUNDS.east - BOUNDS.west) * GRID))),
  y: Math.max(0, Math.min(GRID - 1, Math.floor((BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south) * GRID))),
});

function epsg3035(lng, lat) {
  // ETRS89 / LAEA Europe (EPSG:3035), the projection idcar_200m carries.
  const a = 6378137, eccentricity = 0.0818191910428158, e2 = eccentricity ** 2;
  const phi = lat * Math.PI / 180, lambda = lng * Math.PI / 180;
  const phi0 = 52 * Math.PI / 180, lambda0 = 10 * Math.PI / 180;
  const q = (angle) => {
    const sine = Math.sin(angle);
    return (1 - e2) * (sine / (1 - e2 * sine * sine)
      - Math.log((1 - eccentricity * sine) / (1 + eccentricity * sine)) / (2 * eccentricity));
  };
  const qp = q(Math.PI / 2), beta = Math.asin(q(phi) / qp), beta0 = Math.asin(q(phi0) / qp);
  const radius = a * Math.sqrt(qp / 2);
  const m0 = Math.cos(phi0) / Math.sqrt(1 - e2 * Math.sin(phi0) ** 2);
  const d = a * m0 / (radius * Math.cos(beta0));
  const b = radius * Math.sqrt(2 / (1 + Math.sin(beta0) * Math.sin(beta)
    + Math.cos(beta0) * Math.cos(beta) * Math.cos(lambda - lambda0)));
  return [4321000 + b * d * Math.cos(beta) * Math.sin(lambda - lambda0),
    3210000 + b / d * (Math.cos(beta0) * Math.sin(beta) - Math.sin(beta0) * Math.cos(beta) * Math.cos(lambda - lambda0))];
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}
const polygonsOf = (geometry) => geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];

function burnPolygon(geometry, value) {
  for (const rings of polygonsOf(geometry)) {
    const points = rings[0];
    const west = Math.min(...points.map((point) => point[0])), east = Math.max(...points.map((point) => point[0]));
    const south = Math.min(...points.map((point) => point[1])), north = Math.max(...points.map((point) => point[1]));
    const a = cellFor(west, north), b = cellFor(east, south);
    for (let y = a.y; y <= b.y; y += 1) for (let x = a.x; x <= b.x; x += 1) {
      const point = [BOUNDS.west + (x + 0.5) / GRID * (BOUNDS.east - BOUNDS.west), BOUNDS.north - (y + 0.5) / GRID * (BOUNDS.north - BOUNDS.south)];
      if (pointInRing(point, rings[0]) && !rings.slice(1).some((hole) => pointInRing(point, hole))) fuel[indexOf(x, y)] = value;
    }
  }
}

function burnLine(geometry, flag) {
  const lines = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
  for (const line of lines) for (let i = 1; i < line.length; i += 1) {
    const a = cellFor(line[i - 1][0], line[i - 1][1]), b = cellFor(line[i][0], line[i][1]);
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
    for (let step = 0; step <= steps; step += 1) {
      const x = Math.round(a.x + (b.x - a.x) * step / steps), y = Math.round(a.y + (b.y - a.y) * step / steps);
      infra[indexOf(x, y)] |= flag;
    }
  }
}

async function wfs(typeName) {
  const pageAt = async (startIndex) => {
    const query = new URLSearchParams({ SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
      OUTPUTFORMAT: 'application/json', SRSNAME: 'EPSG:4326', COUNT: '1000', STARTINDEX: String(startIndex),
      TYPENAMES: typeName, BBOX: `${BOUNDS.west},${BOUNDS.south},${BOUNDS.east},${BOUNDS.north},EPSG:4326` });
    const response = await fetch(`https://data.geopf.fr/wfs/ows?${query}`);
    if (!response.ok) throw new Error(`${typeName}: WFS ${response.status}`);
    return response.json();
  };
  const firstPage = await pageAt(0);
  const features = [...firstPage.features];
  const starts = [];
  for (let startIndex = 1000; startIndex < Number(firstPage.numberMatched || 0); startIndex += 1000) starts.push(startIndex);
  for (let offset = 0; offset < starts.length; offset += 12) {
    const pages = await Promise.all(starts.slice(offset, offset + 12).map(pageAt));
    for (const page of pages) features.push(...page.features);
  }
  return features;
}

const forests = await wfs('LANDCOVER.FORESTINVENTORY.V2:formation_vegetale');
for (const feature of forests) {
  const label = `${feature.properties?.essence || ''} ${feature.properties?.tfv || ''}`.toLowerCase();
  const speciesIndex = label.includes('feuillu') || label.includes('chêne') // IGN source labels are French ? 6 : 0;
  burnPolygon(feature.geometry, speciesIndex);
}
const roads = await wfs('BDTOPO_V3:troncon_de_route');
for (const feature of roads) {
  const properties = feature.properties || {};
  const track = properties.piste_dfci || /sentier|chemin|piste/i.test(properties.nature || '');
  burnLine(feature.geometry, track ? 1 : 2);
}
const buildings = await wfs('BDTOPO_V3:batiment');
for (const feature of buildings) for (const rings of polygonsOf(feature.geometry)) {
  const point = rings[0][0];
  const cell = cellFor(point[0], point[1]);
  infra[indexOf(cell.x, cell.y)] |= 4;
}

const projectedCorners = [epsg3035(BOUNDS.west, BOUNDS.south), epsg3035(BOUNDS.east, BOUNDS.north), epsg3035(BOUNDS.west, BOUNDS.north), epsg3035(BOUNDS.east, BOUNDS.south)];
const minE = Math.min(...projectedCorners.map((point) => point[0])), maxE = Math.max(...projectedCorners.map((point) => point[0]));
const minN = Math.min(...projectedCorners.map((point) => point[1])), maxN = Math.max(...projectedCorners.map((point) => point[1]));
const rows = readline.createInterface({ input: fs.createReadStream(inseePath), crlfDelay: Infinity });
let header = null, idIndex = -1, peopleIndex = -1;
for await (const line of rows) {
  if (!header) { header = line.split(','); idIndex = header.indexOf('idcar_200m'); peopleIndex = header.indexOf('ind'); continue; }
  const columns = line.split(',');
  const match = /N(\d+)E(\d+)/.exec(columns[idIndex]);
  if (!match) continue;
  const northing = Number(match[1]), easting = Number(match[2]);
  if (easting < minE || easting > maxE || northing < minN || northing > maxN) continue;
  const x = Math.max(0, Math.min(GRID - 1, Math.floor((easting - minE) / (maxE - minE) * GRID)));
  const y = Math.max(0, Math.min(GRID - 1, Math.floor((maxN - northing) / (maxN - minN) * GRID)));
  const count = Number(columns[peopleIndex]);
  if (Number.isFinite(count)) people10[indexOf(x, y)] = Math.min(65535, people10[indexOf(x, y)] + Math.round(count * 10));
}

const elevation = new Float32Array(ELEVATION_GRID * ELEVATION_GRID);
const probes = [];
for (let y = 0; y < ELEVATION_GRID; y += 1) for (let x = 0; x < ELEVATION_GRID; x += 1) probes.push({
  x, y, lng: BOUNDS.west + (x + 0.5) / ELEVATION_GRID * (BOUNDS.east - BOUNDS.west),
  lat: BOUNDS.north - (y + 0.5) / ELEVATION_GRID * (BOUNDS.north - BOUNDS.south),
});
for (let offset = 0; offset < probes.length; offset += 50) {
  const batch = probes.slice(offset, offset + 50);
  const query = new URLSearchParams({ latitude: batch.map((point) => point.lat).join(','), longitude: batch.map((point) => point.lng).join(',') });
  let response;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(`https://api.open-meteo.com/v1/elevation?${query}`);
    if (response.status !== 429) break;
    await wait(5000 * (attempt + 1));
  }
  if (!response.ok) throw new Error(`Open-Meteo elevation: ${response.status}`);
  const data = await response.json();
  const values = Array.isArray(data) ? data.map((item) => item.elevation) : data.elevation;
  values.forEach((value, index) => { elevation[offset + index] = Number(value) || 0; });
  await wait(500);
}
const sampleElevation = (x, y) => elevation[Math.max(0, Math.min(ELEVATION_GRID - 1, y)) * ELEVATION_GRID + Math.max(0, Math.min(ELEVATION_GRID - 1, x))];
const cellM = 50000 / ELEVATION_GRID;
for (let y = 0; y < GRID; y += 1) for (let x = 0; x < GRID; x += 1) {
  const ex = Math.floor(x / GRID * ELEVATION_GRID), ey = Math.floor(y / GRID * ELEVATION_GRID);
  const dzdx = (sampleElevation(ex + 1, ey) - sampleElevation(ex - 1, ey)) / (2 * cellM);
  const dzdy = (sampleElevation(ex, ey + 1) - sampleElevation(ex, ey - 1)) / (2 * cellM);
  slope[indexOf(x, y)] = Math.round(Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI);
  aspect[indexOf(x, y)] = Math.round(((Math.atan2(dzdx, -dzdy) * 180 / Math.PI + 360) % 360) / 360 * 255);
}

const output = {
  version: 1, gridSize: GRID, bounds: BOUNDS,
  sources: {
    forest: 'IGN BD Forêt v2 via Géoplateforme WFS, Licence Ouverte Etalab 2.0',
    infrastructure: 'IGN BD TOPO v3 via Géoplateforme WFS, Licence Ouverte Etalab 2.0',
    population: 'INSEE Filosofi 2021, carreaux 200 m, février 2026, Licence Ouverte Etalab 2.0',
    elevation: 'Open-Meteo Elevation API, DEM 90 m, CC BY 4.0; Copernicus GLO-30 not bundled, as authenticated access has been required since 28/07/2026',
  },
  encoding: 'base64 raw typed arrays; people10 is little-endian uint16 in tenths of a person',
  fuel: Buffer.from(fuel).toString('base64'), infra: Buffer.from(infra).toString('base64'),
  people10: Buffer.from(people10.buffer).toString('base64'), slope: Buffer.from(slope).toString('base64'), aspect: Buffer.from(aspect).toString('base64'),
  counts: { forests: forests.length, roads: roads.length, buildings: buildings.length },
};
process.stdout.write(`${JSON.stringify(output)}\n`);
