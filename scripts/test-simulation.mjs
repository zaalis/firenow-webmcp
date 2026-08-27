import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const self = { postMessage() {} };
const context = vm.createContext({ self, Math, Number, String, Array, Object, Infinity, Uint8Array, Float32Array });
vm.runInContext(fs.readFileSync(new URL('../public/simulation.worker.js', import.meta.url), 'utf8'), context);

const engine = self.__fireopsTest;
const base = { independent: true, targetMinutes: 360, moisture: 0.08, windKph: 32, windDirection: 'Nord-ouest', slopeDegrees: 7.4 };
const north = engine.simulate({ ...base, deployments: [{ type: 'CCF', count: 12, lng: -0.4541, lat: 44.597, radiusM: 1200, capacity: 0.09 }] });
const south = engine.simulate({ ...base, deployments: [{ type: 'CCF', count: 12, lng: -0.446, lat: 44.5825, radiusM: 1200, capacity: 0.09 }] });
const unsuppressed = engine.simulate({ ...base, deployments: [] });
const oneHour = engine.simulate({ ...base, targetMinutes: 60, deployments: [] });

assert.equal(engine.GRID_SIZE, 128);
assert.ok(unsuppressed.rateOfSpreadMetersPerMinute >= 15 && unsuppressed.rateOfSpreadMetersPerMinute <= 35, `ROS 32 km/h hors plage: ${unsuppressed.rateOfSpreadMetersPerMinute}`);
assert.notEqual(north.totalBurnedHa, south.totalBurnedHa, 'La suppression nord et sud ne doit pas produire la même surface.');
assert.equal(unsuppressed.perimeterGeoJSON.geometry.type, 'Polygon');
assert.ok(unsuppressed.totalBurnedHa > oneHour.totalBurnedHa, 'La surface totale doit croître avec le temps.');

console.log(JSON.stringify({
  ros32: unsuppressed.rateOfSpreadMetersPerMinute,
  northHa: north.totalBurnedHa,
  southHa: south.totalBurnedHa,
  unsuppressedHa: unsuppressed.totalBurnedHa,
  oneHourHa: oneHour.totalBurnedHa,
  grid: `${engine.GRID_SIZE}x${engine.GRID_SIZE}`,
  cellMeters: engine.CELL_METERS,
}));
