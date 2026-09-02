'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl';
import {
  Bot, CarFront, Check, ChevronDown, CircleHelp, Command, Container as ContainerIcon,
  FireExtinguisher, Flame, Globe2, Helicopter, Layers3, LogOut, Map as MapIcon,
  Pause, Plane, PlaneTakeoff, Play, Plus, RotateCcw, ShieldCheck,
  Tractor, Truck, Undo2, Users, Wind, X, ChevronUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Tour, { TOUR_PENDING_KEY, type TourStep } from './tour';
import AgentBridge, { type InitialToolCall } from './agent-bridge';

type ViewMode = '2D' | '3D' | 'globe';
type Weather = { windSpeed: number; windDirection: string; windBearing: number; gusts: number; temperature: number; humidity: number; droughtIndex: number; plumeDriven?: boolean };
type WeatherSeriesPoint = { hourFromStart: number; temperature: number; humidity: number; windKph: number; windBearingDegrees: number };
type Domain = { lng: number; lat: number; boxMetres: number };
type Exposure = {
  residentsReached: number; residentsAtRisk: number;
  builtAreaBurnedHa: number; tracksCutKm: number; roadsCutKm: number;
};
type Region = 'gironde' | 'marseille' | 'california-basin' | 'california-chaparral' | 'california-sierra';
type Terrain = { region?: Region; oceanWestOfLng?: number; water?: { lng: number; lat: number; radiusM: number }[]; urban?: { lng: number; lat: number; radiusM: number }[] };
type LandscapeAsset = { gridSize: number; bounds: { west: number; east: number; south: number; north: number }; sources: Record<string, string>; fuel: string; infra: string; people10: string; slope: string; aspect: string };
type Deployment = { id: string; type: string; count: number; autonomy?: number; sector: string; mission: string; lng: number; lat: number; radiusM: number; capacity: number; staged?: boolean };
type Firebreak = { name: string; sector: string; lengthKm: number; coordinates: [number, number][]; widthM?: number; staffed?: boolean; tacticalBurn?: boolean };
type StrategyResult = { name: string; burnedHa: number; rateOfSpread: number; resources: number; description: string; deployments: Deployment[] };
type Plan = {
  id: string; name: string; intention: string; deployments: Deployment[];
  tasks: { unitId: string; mission: string }[];
  firebreaks: Firebreak[];
  evacuations: { name: string; sector: string; population: number }[];
  movedFrom?: string[];
  comparison?: StrategyResult[];
};
type Activity = { id: string; tool: string; label: string; state: 'done' | 'error'; at: string };
type Ignition = { lng: number; lat: number; radiusM: number };
type Suppression = {
  firelineIntensityKwM: number; meanIntensityKwM: number; activePerimeterM: number;
  headM: number; flankM: number; rearM: number; requiredFlowLpm: number;
  deployedFlowLpm: number; containmentRatio: number; containmentMinutes: number | null;
  litresPerHour: number; attackViable: boolean; status: 'out' | 'controlled' | 'contained' | 'spreading';
  attackMode: 'direct' | 'heavy-units' | 'indirect'; appliances: number; lineMetresPerHour: number;
};
type Scenario = {
  id: string; name: string; createdAt: number; preset: 'landiras' | 'saumos' | 'etoile' | 'bug' | 'blank';
  ignition: Ignition | null; minutes: number; weather: Weather; committed: Deployment[]; firebreaks: Firebreak[];
  domain: Domain; terrain?: Terrain; incident: Incident; burnedHa: number | null;
};
// The header used to show the Landiras date whatever scenario was open.
type Incident = { ref: string; dateLabel: string; startHour: number; startMinute: number; startDate?: string; endDate?: string };
type ToolDefinition = {
  name: string; title: string; description: string; inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>, options?: WebMCP.ToolExecuteCallbackOptions) => unknown | Promise<unknown>;
};
type ModelContextLike = {
  registerTool: (tool: ToolDefinition, options?: { signal?: AbortSignal }) => Promise<void> | void;
};

type UnitFamily = 'ground' | 'air' | 'engineering';
type UnitCatalogue = { code: string; count: number; label: string; family: UnitFamily; tank: string; capacityLitres?: number };

const initialWeather: Weather = {
  windSpeed: 22, windDirection: 'North-west', windBearing: 135, gusts: 38,
  temperature: 39, humidity: 19, droughtIndex: 0.95,
};
// The fleet carries the manufacturer figures the engine works from: tank,
// pump rate and refill time together give the flow a unit can actually hold.
const units: UnitCatalogue[] = [
  { code: 'VLHR', count: 14, label: 'Light off-road wildland units', family: 'ground', tank: '600 L', capacityLitres: 600 },
  { code: 'CCF',  count: 18, label: 'Wildland fire engines', family: 'ground', tank: '4,000 L', capacityLitres: 4000 },
  { code: 'CCFS', count: 6,  label: 'Heavy wildland engines', family: 'ground', tank: '8,000 L', capacityLitres: 8000 },
  { code: 'FPT',  count: 6,  label: 'Structure pumpers', family: 'ground', tank: '3,000 L', capacityLitres: 3000 },
  { code: 'CCGC', count: 4,  label: 'Large water tenders', family: 'ground', tank: '13,000 L', capacityLitres: 13000 },
  { code: 'HBE',  count: 2,  label: 'Water-dropping helicopters', family: 'air', tank: '1,000 L', capacityLitres: 1000 },
  { code: 'HELIT', count: 1, label: 'Heavy helicopter S-64', family: 'air', tank: '9,500 L', capacityLitres: 9500 },
  { code: 'AT8',  count: 4,  label: 'Air Tractor AT-802F', family: 'air', tank: '3,100 L', capacityLitres: 3100 },
  { code: 'CL4',  count: 4,  label: 'Canadair CL-415', family: 'air', tank: '6,137 L', capacityLitres: 6137 },
  { code: 'DASH', count: 2,  label: 'Dash-8 Q400MR', family: 'air', tank: '10,000 L', capacityLitres: 10000 },
  { code: 'A400', count: 1,  label: 'A400M (retardant)', family: 'air', tank: '20,000 L', capacityLitres: 20000 },
  { code: 'DOZ',  count: 3,  label: 'Bulldozers', family: 'engineering', tank: '320 m/h' },
  { code: 'CREW', count: 8,  label: 'Hand crews (20 firefighters)', family: 'engineering', tank: '90 m/h' },
];
const UNIT_ICONS: Record<string, LucideIcon> = {
  VLHR: CarFront, CCF: Truck, CCFS: Truck, FPT: FireExtinguisher, CCGC: ContainerIcon,
  HBE: Helicopter, HELIT: Helicopter, AT8: PlaneTakeoff, CL4: Plane, DASH: Plane,
  A400: Plane, DOZ: Tractor, CREW: Users,
};
const UNIT_CODES = units.map((unit) => unit.code);
const unitSuppressionCapacity = (type: string) => {
  const family = units.find((unit) => unit.code === type)?.family;
  if (type === 'CCF' || type === 'CCFS') return 0.09;
  if (family === 'air') return 0.08;
  if (family === 'engineering') return 0.05;
  return 0.06;
};
const unitFamilyClass = (family: UnitFamily) => family;
const unitCapacityLevel = (unit: UnitCatalogue) => unit.family === 'engineering' || (unit.capacityLitres || 0) > 9000
  ? 3 : (unit.capacityLitres || 0) >= 3000 ? 2 : 1;
const REGION_LABEL: Record<string, string> = {
  gironde: 'Landes de Gascogne pine forest',
  marseille: 'Provence limestone garrigue',
  'california-basin': 'Great Basin · sagebrush steppe',
  'california-chaparral': 'Cismontane chaparral',
  'california-sierra': 'Sierra Nevada · montane forest',
};
const FAMILIES: UnitFamily[] = ['ground', 'air', 'engineering'];
const FAMILY_LABEL: Record<UnitFamily, string> = { ground: 'Ground', air: 'Air', engineering: 'Engineering' };
const FLEET_TOTAL = units.reduce((sum, unit) => sum + unit.count, 0);
const TIMELINE_MAX_MINUTES = 12 * 60;
const toolActivityLabel = (tool: string, result: unknown) => {
  const value = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  if (tool === 'commit_plan') return value.approved === true ? 'Plan approved and applied' : 'Plan rejected by the operator';
  if (tool === 'run_simulation') return `Simulation advanced by ${value.advancedMinutes} min`;
  if (tool === 'set_time') return `Timeline set to H+${String(Math.floor(Number(value.minutesFromIgnition || 0) / 60)).padStart(2, '0')}:${String(Number(value.minutesFromIgnition || 0) % 60).padStart(2, '0')}`;
  const labels: Record<string, string> = {
    get_situation: 'Operational situation read', list_units: 'Fleet and committed units read',
    get_fire_forecast: 'T+1 h, T+3 h and T+6 h projection computed', get_weather: 'Current weather read',
    query_terrain: 'Sector terrain analysed', list_scenarios: 'Available scenarios read',
    propose_plan: 'Draft plan opened', stage_deploy_units: 'Units staged in the plan',
    stage_assign_task: 'Task added to the draft plan', stage_firebreak: 'Control line added to the plan',
    stage_tactical_burn: 'Tactical burn prepared, not ignited', stage_evacuation_zone: 'Evacuation zone prepared, no order sent',
    revert_plan: 'Last plan reverted', set_weather: 'Simulation weather updated',
    ignite: 'Exercise ignition repositioned', compare_plans: 'Three strategies computed by the engine',
    focus_region: 'Map recentred on the requested scenario', set_view_mode: 'Map mode applied',
  };
  return labels[tool] || 'Verifiable result returned';
};
const planDescriptions = [
  'Units massed on the north flank and the village edge.',
  'Mobile split across both flanks with a central reserve.',
  'Reference projection with no additional unit committed.',
];
const defaultIgnition: Ignition = { lng: -0.4540519, lat: 44.5897472, radiusM: 0 };
const landirasUnits = (): Deployment[] => [
  { id: 'ccf22', type: 'CCF', count: 22, sector: 'North-east flank', mission: 'Hold the left flank', lng: -0.4159, lat: 44.6088, radiusM: 2200, capacity: 0.09 },
  { id: 'ccf18', type: 'CCF', count: 18, sector: 'South-west flank', mission: 'Hold the right flank', lng: -0.4922, lat: 44.5707, radiusM: 2200, capacity: 0.09 },
  { id: 'fpt08', type: 'FPT', count: 8, sector: 'South-east', mission: 'Structure defence', lng: -0.4139, lat: 44.5611, radiusM: 1600, capacity: 0.06 },
  { id: 'cl404', type: 'CL4', count: 4, sector: 'Head', mission: 'Drops on the fire head', lng: -0.4272, lat: 44.5707, radiusM: 2600, capacity: 0.08 },
  { id: 'hbe02', type: 'HBE', count: 2, sector: 'North-east flank', mission: 'Helicopter support', lng: -0.4362, lat: 44.6025, radiusM: 1800, capacity: 0.08 },
  { id: 'doz04', type: 'DOZ', count: 4, sector: 'South-east', mission: 'DFCI control line', lng: -0.4050, lat: 44.5548, radiusM: 2000, capacity: 0.05 },
];
const LANDIRAS_DOMAIN: Domain = { lng: -0.4540519, lat: 44.5897472, boxMetres: 25000 };
// Saumos (44.921 N / -0.987 W). The fire runs south-west then west, so a
// 50 km window is needed to hold the 47,000 ha it eventually burned.
const SAUMOS_IGNITION: Ignition = { lng: -0.987, lat: 44.921, radiusM: 0 };
const SAUMOS_DOMAIN: Domain = { lng: -1.10, lat: 44.80, boxMetres: 50000 };
// Without the coastline and the water bodies the simulation spreads fire over
// the Atlantic, and any comparison with the real event stops meaning anything.
const SAUMOS_TERRAIN: Terrain = {
  region: 'gironde',
  oceanWestOfLng: -1.205,
  water: [
    { lng: -1.135, lat: 44.990, radiusM: 3200 },  // Lacanau lake
    { lng: -1.130, lat: 44.680, radiusM: 7000 },  // Arcachon bay
  ],
  urban: [
    { lng: -1.078, lat: 44.980, radiusM: 1500 },  // Lacanau
    { lng: -1.091, lat: 44.874, radiusM: 1300 },  // Le Porge
    { lng: -0.987, lat: 44.921, radiusM: 700 },   // Saumos
  ],
};
// Etoile massif, north-east of Marseille. North-west mistral, garrigue and
// Aleppo pine: the sharpest available contrast with the Landes.
const ETOILE_IGNITION: Ignition = { lng: 5.4474, lat: 43.3170, radiusM: 0 };
const ETOILE_DOMAIN: Domain = { lng: 5.4474, lat: 43.3170, boxMetres: 25000 };
const ETOILE_TERRAIN: Terrain = {
  region: 'marseille',
  urban: [
    { lng: 5.3698, lat: 43.2965, radiusM: 4200 },  // Marseille nord
    { lng: 5.4830, lat: 43.3370, radiusM: 1400 },  // Allauch
    { lng: 5.5620, lat: 43.3480, radiusM: 1200 },  // Plan-de-Cuques / Camoins
  ],
};
const etoileWeather = (): Weather => ({
  windSpeed: 55, windDirection: 'North-west', windBearing: 135, gusts: 82,
  temperature: 34, humidity: 24, droughtIndex: 0.88,
});
const etoileUnits = (): Deployment[] => [
  { id: 'eccf1', type: 'CCF', count: 20, sector: 'Urban edge', mission: 'Structure defence', lng: 5.4130, lat: 43.3050, radiusM: 2400, capacity: 0.09, autonomy: 90 },
  { id: 'ecl41', type: 'CL4', count: 4, sector: 'Head', mission: 'Drops on the head', lng: 5.4900, lat: 43.2960, radiusM: 3000, capacity: 0.08, autonomy: 80 },
  { id: 'ehbe1', type: 'HBE', count: 3, sector: 'East flank', mission: 'Helicopter support', lng: 5.4980, lat: 43.3300, radiusM: 2200, capacity: 0.08, autonomy: 75 },
  { id: 'ecrw1', type: 'CREW', count: 6, sector: 'Ridgelines', mission: 'Ridgeline control line', lng: 5.4600, lat: 43.3400, radiusM: 2000, capacity: 0.05, autonomy: 85 },
];

// Bug Fire: Long Valley, Lassen County. Sagebrush, grass and pinyon-juniper,
// sustained west wind (Washoe Zephyr), very light units.
const BUG_IGNITION: Ignition = { lng: -120.0366, lat: 39.7229, radiusM: 0 };
const BUG_DOMAIN: Domain = { lng: -119.90, lat: 39.72, boxMetres: 50000 };
const BUG_TERRAIN: Terrain = { region: 'california-basin' };
const bugWeather = (): Weather => ({
  windSpeed: 28, windDirection: 'West', windBearing: 95, gusts: 56,
  temperature: 38, humidity: 12, droughtIndex: 0.92,
});
const bugUnits = (): Deployment[] => [
  { id: 'bccf1', type: 'CCF', count: 12, sector: 'South flank', mission: 'Hold the flank', lng: -120.0366, lat: 39.6870, radiusM: 4000, capacity: 0.09, autonomy: 70 },
  { id: 'bdoz1', type: 'DOZ', count: 4, sector: 'East', mission: 'Control line', lng: -119.9700, lat: 39.7420, radiusM: 4000, capacity: 0.05, autonomy: 70 },
  { id: 'bhbe1', type: 'HBE', count: 2, sector: 'Head', mission: 'Helicopter support', lng: -119.9800, lat: 39.7229, radiusM: 4000, capacity: 0.08, autonomy: 60 },
];
const saumosWeather = (): Weather => ({
  windSpeed: 26, windDirection: 'North-east', windBearing: 225, gusts: 42,
  temperature: 38, humidity: 22, droughtIndex: 0.96,
});
// 3,300 firefighters, 18 aircraft, 121 km of firebreak, 105 wildland units.
const saumosUnits = (): Deployment[] => [
  { id: 'sccf1', type: 'CCF', count: 45, sector: 'South flank', mission: 'Hold the south flank', lng: -0.9870, lat: 44.8671, radiusM: 5000, capacity: 0.09 },
  { id: 'sccf2', type: 'CCF', count: 45, sector: 'South-east flank', mission: 'Hold the east flank', lng: -0.9330, lat: 44.8828, radiusM: 5000, capacity: 0.09 },
  { id: 'sccf3', type: 'CCF', count: 40, sector: 'Le Porge', mission: 'Structure defence', lng: -1.0678, lat: 44.8639, radiusM: 5000, capacity: 0.09 },
  { id: 'sfpt1', type: 'FPT', count: 30, sector: 'Littoral', mission: 'Protect the coastline', lng: -1.1298, lat: 44.8841, radiusM: 4500, capacity: 0.06 },
  { id: 'scl41', type: 'CL4', count: 9, sector: 'Head', mission: 'Drops on the head', lng: -1.0872, lat: 44.9085, radiusM: 6000, capacity: 0.08 },
  { id: 'shbe1', type: 'HBE', count: 9, sector: 'South flank', mission: 'Helicopter support', lng: -1.0170, lat: 44.8618, radiusM: 5000, capacity: 0.08 },
  { id: 'sdoz1', type: 'DOZ', count: 30, sector: 'West', mission: 'Firebreak (121 km cut)', lng: -1.1521, lat: 44.9210, radiusM: 5500, capacity: 0.05 },
];
const blankWeather = (): Weather => ({ windSpeed: 12, windDirection: 'West', windBearing: 90, gusts: 18, temperature: 24, humidity: 45, droughtIndex: 0.40 });
const LANDIRAS_INCIDENT: Incident = { ref: 'INCIDENT 33-2022-0712', dateLabel: '12 JULY 2022', startHour: 14, startMinute: 0, startDate: '2022-07-12', endDate: '2022-07-20' };
const ETOILE_INCIDENT: Incident = { ref: 'EXERCISE 13-ETOILE', dateLabel: 'EXERCISE', startHour: 13, startMinute: 0 };
const BUG_INCIDENT: Incident = { ref: 'INCIDENT CA-LNU-2026-0808', dateLabel: '8 AUGUST 2026', startHour: 13, startMinute: 0, startDate: '2026-08-08', endDate: '2026-08-15' };
const SAUMOS_INCIDENT: Incident = { ref: 'INCIDENT 33-2026-0722', dateLabel: '22 JULY 2026', startHour: 13, startMinute: 30, startDate: '2026-07-22', endDate: '2026-07-26' };
const BLANK_INCIDENT: Incident = { ref: 'FREE SIMULATION', dateLabel: 'T0', startHour: 12, startMinute: 0 };
const makeScenario = (name: string, preset: 'landiras' | 'saumos' | 'etoile' | 'bug' | 'blank'): Scenario => {
  const base = { id: nextId(), name, createdAt: Date.now(), preset, burnedHa: null };
  if (preset === 'landiras') return { ...base, ignition: { ...defaultIgnition }, minutes: 162, weather: { ...initialWeather }, committed: landirasUnits(), firebreaks: [], domain: LANDIRAS_DOMAIN, terrain: { region: 'gironde' }, incident: LANDIRAS_INCIDENT };
  if (preset === 'etoile') return { ...base, ignition: { ...ETOILE_IGNITION }, minutes: 240, weather: etoileWeather(), committed: etoileUnits(), firebreaks: [], domain: ETOILE_DOMAIN, terrain: ETOILE_TERRAIN, incident: ETOILE_INCIDENT };
  if (preset === 'bug') return { ...base, ignition: { ...BUG_IGNITION }, minutes: 480, weather: bugWeather(), committed: bugUnits(), firebreaks: [], domain: BUG_DOMAIN, terrain: BUG_TERRAIN, incident: BUG_INCIDENT };
  if (preset === 'saumos') return { ...base, ignition: { ...SAUMOS_IGNITION }, minutes: 450, weather: saumosWeather(), committed: saumosUnits(), firebreaks: [], domain: SAUMOS_DOMAIN, terrain: SAUMOS_TERRAIN, incident: SAUMOS_INCIDENT };
  return { ...base, ignition: null, minutes: 0, weather: blankWeather(), committed: [], firebreaks: [], domain: LANDIRAS_DOMAIN, terrain: { region: 'gironde' }, incident: BLANK_INCIDENT };
};
// Raster basemap: loaded by the main thread, unlike vector tiles, which go
// through the MapLibre worker and never reach it on production hosting. Esri
// serves base and labels as two separate layers with no API key -- CARTO now
// watermarks its raster tiles with "API KEY REQUIRED".
const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas';
// The last level the service actually covers, and the map's zoom ceiling:
// beyond it only mush gets stretched, and the simulation grid (195 to 390 m
// per cell) has nothing left to show anyway.
const BASEMAP_MAX_ZOOM = 16;
const MAP_MAX_ZOOM = 17.5;
// MapLibre derives its worker URL from its own `import.meta.url`. Once bundled,
// that URL points at a file the bundler never emits: the worker 404s, no GeoJSON
// source loads and no vector layer is drawn at all -- the fire disappears and
// only the DOM markers remain. So the official worker is served from public/
// (see scripts/sync-maplibre-worker.mjs).
const MAPLIBRE_WORKER_URL = '/maplibre/maplibre-gl-worker.mjs';
// Secondary ignitions accepted on top of the primary one. The engine enforces
// the same bound on its side, so map and simulation cannot drift apart.
const MAX_EXTRA_IGNITIONS = 11;
// The zoom at which each unit gets its own marker back and becomes
// draggable; below it the units are clustered.
const UNIT_CLUSTER_ZOOM = 10.2;
const BASEMAP_STYLE = {
  version: 8 as const,
  sources: {
    // The service advertises 23 levels but really covers only up to 16 over
    // the massif: past that it returns a "Map data not yet available" tile.
    // Bounding the source makes MapLibre stretch the last real tile
    // valid one instead of reaching for this placeholder.
    esriBase: {
      type: 'raster' as const,
      tiles: [ESRI + '/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: BASEMAP_MAX_ZOOM,
      attribution: 'Esri, HERE, Garmin, © OpenStreetMap',
    },
    esriLabels: {
      type: 'raster' as const,
      tiles: [ESRI + '/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: BASEMAP_MAX_ZOOM,
    },
  },
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#08090A' } },
    // The basemap stays recessive: the fire outranks the map.
    { id: 'basemap', type: 'raster' as const, source: 'esriBase',
      paint: { 'raster-saturation': -1, 'raster-brightness-max': 0.62, 'raster-opacity': 0.95 } },
    { id: 'basemap-labels', type: 'raster' as const, source: 'esriLabels',
      paint: { 'raster-saturation': -1, 'raster-brightness-max': 0.9, 'raster-opacity': 0.8 } },
  ],
};
const emptyGeoJSON = { type: 'FeatureCollection', features: [] } as const;
// bearing = the heading the fire spreads towards; `from` = where the wind blows from, shown to the operator.
const COMPASS = [
  { index: 0, short: 'N',  label: 'Driving north',      from: 'South',      bearing: 0 },
  { index: 1, short: 'NE', label: 'Driving north-east', from: 'South-west', bearing: 45 },
  { index: 2, short: 'E',  label: 'Driving east',       from: 'West',       bearing: 90 },
  { index: 3, short: 'SE', label: 'Driving south-east', from: 'North-west', bearing: 135 },
  { index: 4, short: 'S',  label: 'Driving south',      from: 'North',      bearing: 180 },
  { index: 5, short: 'SW', label: 'Driving south-west', from: 'North-east', bearing: 225 },
  { index: 6, short: 'W',  label: 'Driving west',       from: 'East',       bearing: 270 },
  { index: 7, short: 'NW', label: 'Driving north-west', from: 'South-east', bearing: 315 },
];
const WEATHER_PRESETS: { label: string; values: Partial<Weather> }[] = [
  { label: 'Calm', values: { windSpeed: 8, gusts: 14, humidity: 55, temperature: 24, droughtIndex: 0.35 } },
  { label: 'Hot and dry', values: { windSpeed: 22, gusts: 34, humidity: 22, temperature: 36, droughtIndex: 0.82 } },
  { label: 'NW shift 40 km/h', values: { windSpeed: 40, gusts: 62, windBearing: 135, windDirection: 'North-west', humidity: 18, temperature: 38, droughtIndex: 0.91 } },
  { label: 'Gusts 70 km/h', values: { windSpeed: 55, gusts: 70, humidity: 15, temperature: 39, droughtIndex: 0.95 } },
  { label: 'Convective plume', values: { windSpeed: 38, gusts: 60, humidity: 18, temperature: 38, droughtIndex: 0.97, plumeDriven: true } },
];
const nextId = () => Math.random().toString(36).slice(2, 9);
const atNow = () => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date());
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const textValue = (value: unknown, field: string, max = 240) => {
  if (typeof value !== 'string') throw new Error(`Field "${field}" must be a non-empty string of at most ${max} characters.`);
  if (!value.trim()) throw new Error(`Field "${field}" cannot be empty. Provide a value of at most ${max} characters.`);
  if (value.length > max) throw new Error(`Field "${field}" holds ${value.length} characters; ${max} are allowed. Shorten the value.`);
  return value.trim();
};
const numberValue = (value: unknown, field: string, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Field "${field}" must be a finite number between ${min} and ${max}.`);
  if (value < min || value > max) throw new Error(`Field "${field}" is ${value}; a value between ${min} and ${max} is expected.`);
  return value;
};
// "North-west" says where the wind comes from; the engine wants the bearing it
// drives towards. Without this conversion set_weather changed the label and
// never deflected the front.
const normalizeCompass = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s_]+/g, '-').trim();
const bearingFromProvenance = (provenance: string) => {
  const wanted = normalizeCompass(provenance);
  const point = COMPASS.find((entry) => normalizeCompass(entry.from) === wanted);
  return point ? point.bearing : null;
};
// An agent can do nothing with a perimeter polygon: it pays for the context
// without being able to draw it. Tools return readable magnitudes only.
const engineDigest = (engine: Record<string, unknown>) => {
  const suppression = engine.suppression as Suppression | undefined;
  return {
    burnedHa: engine.totalBurnedHa,
    rateOfSpreadMetersPerMinute: engine.rateOfSpreadMetersPerMinute,
    forecastBurnedHa: engine.forecastBurnedHa,
    spotFires: engine.spotFires,
    perimeterBounds: engine.bounds,
    exposure: engine.exposure,
    suppression: suppression && {
      status: suppression.status, attackMode: suppression.attackMode, attackViable: suppression.attackViable,
      firelineIntensityKwM: suppression.firelineIntensityKwM, requiredFlowLpm: suppression.requiredFlowLpm,
      deployedFlowLpm: suppression.deployedFlowLpm, containmentMinutes: suppression.containmentMinutes,
      headM: suppression.headM, flankM: suppression.flankM, rearM: suppression.rearM,
    },
    calibrationStatus: 'not_performed',
  };
};
// Unmounting a React root from effect cleanup happens while React is still
// rendering, so the unmount is pushed out of the render phase.
const unmountLater = (root: Root) => { queueMicrotask(() => root.unmount()); };
const emptyPlan = (name = 'Agent plan', intention = 'Reinforce village protection under a shifting wind.'): Plan => ({
  id: nextId(), name, intention, deployments: [], tasks: [], firebreaks: [], evacuations: [],
});
const summarizePlan = (plan: Plan) => ({
  id: plan.id,
  name: plan.name,
  deploymentGroups: plan.deployments.length,
  totalUnits: plan.deployments.reduce((sum, item) => sum + item.count, 0),
  taskCount: plan.tasks.length,
  firebreakCount: plan.firebreaks.length,
  firebreakLengthKm: Number(plan.firebreaks.reduce((sum, item) => sum + item.lengthKm, 0).toFixed(2)),
  evacuationZoneCount: plan.evacuations.length,
  evacuationPopulation: plan.evacuations.reduce((sum, item) => sum + item.population, 0),
});
const scenarioPresets: { id: Scenario['preset']; name: string; kind: 'historical' | 'exercise' | 'free'; domain: Domain }[] = [
  { id: 'landiras', name: 'Landiras · 12 Jul 2022', kind: 'historical', domain: LANDIRAS_DOMAIN },
  { id: 'saumos', name: 'Saumos · 22 Jul 2026', kind: 'historical', domain: SAUMOS_DOMAIN },
  { id: 'etoile', name: 'Marseille · Étoile massif', kind: 'exercise', domain: ETOILE_DOMAIN },
  { id: 'bug', name: 'Bug Fire · 8 August 2026', kind: 'historical', domain: BUG_DOMAIN },
  { id: 'blank', name: 'Blank simulation', kind: 'free', domain: LANDIRAS_DOMAIN },
];

const initialScenarios: Scenario[] = [makeScenario('Landiras · 12 Jul 2022', 'landiras')];

export default function FireNowClient({ userEmail, initialCall = null }: { userEmail: string; initialCall?: InitialToolCall | null }) {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Markers are keyed by what they contain: while the key holds, the marker and
  // its React root are reused rather than destroyed. Without that, every map
  // move recreated them all and they flashed as white pills during the render.
  const markersRef = useRef<globalThis.Map<string, { marker: Marker; root: Root }>>(new globalThis.Map());
  const engineGeoRef = useRef<{ perimeter: unknown; active: unknown; extinguished: unknown; forecast: unknown }>({ perimeter: emptyGeoJSON, active: emptyGeoJSON, extinguished: emptyGeoJSON, forecast: emptyGeoJSON });
  const simulationWorker = useRef<Worker | null>(null);
  const reviewResolver = useRef<((approved: boolean) => void) | null>(null);
  const [modelContextReady, setModelContextReady] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [ignition, setIgnition] = useState<Ignition | null>(defaultIgnition);
  const [additionalIgnitions, setAdditionalIgnitions] = useState<Ignition[]>([]);
  const extraIgnitionsRef = useRef<Ignition[]>([]);
  const [pickingIgnition, setPickingIgnition] = useState(false);
  const [draftIgnition, setDraftIgnition] = useState<Ignition | null>(null);
  const ignitionRef = useRef<Ignition | null>(defaultIgnition);
  const pickingRef = useRef(false);
  useEffect(() => { pickingRef.current = pickingIgnition; }, [pickingIgnition]);
  useEffect(() => { ignitionRef.current = ignition; }, [ignition]);
  const [agentOpen, setAgentOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('2D');
  const [weather, setWeather] = useState(initialWeather);
  const [weatherSeries, setWeatherSeries] = useState<WeatherSeriesPoint[] | null>(null);
  const [weatherSource, setWeatherSource] = useState<'loading' | 'open-meteo' | 'manual' | 'error'>('loading');
  const weatherSeriesRef = useRef<WeatherSeriesPoint[] | null>(null);
  const [minutes, setMinutes] = useState(162);
  const [scenarios, setScenarios] = useState<Scenario[]>(initialScenarios);
  const [activeScenario, setActiveScenario] = useState<string>(() => initialScenarios[0].id);
  const [accountOpen, setAccountOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [burnedHa, setBurnedHa] = useState<number | null>(null);
  const [frontRate, setFrontRate] = useState<number | null>(null);
  const [suppression, setSuppression] = useState<Suppression | null>(null);
  const [perimeterGeoJSON, setPerimeterGeoJSON] = useState<unknown>(emptyGeoJSON);
  const [forecastGeoJSON, setForecastGeoJSON] = useState<unknown>(emptyGeoJSON);
  const [activeGeoJSON, setActiveGeoJSON] = useState<unknown>(emptyGeoJSON);
  const [extinguishedGeoJSON, setExtinguishedGeoJSON] = useState<unknown>(emptyGeoJSON);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(20);
  const [stagedPlan, setStagedPlan] = useState<Plan | null>(null);
  const [committed, setCommitted] = useState<Deployment[]>(landirasUnits);
  const [committedFirebreaks, setCommittedFirebreaks] = useState<Firebreak[]>([]);
  // The simulation open at startup never goes through the switcher, and without
  // this its domain and geography never reached the engine.
  const [domain, setDomain] = useState<Domain>(initialScenarios[0].domain);
  const [terrain, setTerrain] = useState<Terrain | undefined>(initialScenarios[0].terrain);
  const [incident, setIncident] = useState<Incident>(initialScenarios[0].incident);
  // Sustainable duty applied to staged units: it bounds the flow they can
  // actually hold over time.
  const [autonomy, setAutonomy] = useState(85);
  const [railOpen, setRailOpen] = useState(true);
  const [situationOpen, setSituationOpen] = useState(true);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'resources' | 'situation' | null>(null);
  const [exposure, setExposure] = useState<Exposure | null>(null);
  const [composition, setComposition] = useState<{ name: string; stratum: string; share: number }[]>([]);
  const [landscapeAsset, setLandscapeAsset] = useState<LandscapeAsset | null>(null);
  const [landscapeStatus, setLandscapeStatus] = useState<'loading' | 'real' | 'procedural'>('loading');
  const landscapeRef = useRef<LandscapeAsset | null>(null);
  const [undoStack, setUndoStack] = useState<{ deployments: Deployment[]; firebreaks: Firebreak[] }[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const stateRef = useRef({ weather, minutes, burnedHa, frontRate, stagedPlan, committed, committedFirebreaks, viewMode, domain, terrain, incident, scenarios, activeScenario });

  useEffect(() => {
    stateRef.current = { weather, minutes, burnedHa, frontRate, stagedPlan, committed, committedFirebreaks, viewMode, domain, terrain, incident, scenarios, activeScenario };
  }, [weather, minutes, burnedHa, frontRate, stagedPlan, committed, committedFirebreaks, viewMode, domain, terrain, incident, scenarios, activeScenario]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const syncViewport = () => {
      setIsNarrowViewport(query.matches);
      if (!query.matches) setMobilePanel(null);
    };
    syncViewport();
    query.addEventListener('change', syncViewport);
    return () => query.removeEventListener('change', syncViewport);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/data/gironde-landscape.json').then((response) => {
      if (!response.ok) throw new Error('Gironde landscape asset unavailable');
      return response.json() as Promise<LandscapeAsset>;
    }).then((asset) => {
      if (cancelled) return;
      landscapeRef.current = asset; setLandscapeAsset(asset); setLandscapeStatus('real');
    }).catch(() => { if (!cancelled) setLandscapeStatus('procedural'); });
    return () => { cancelled = true; };
  }, []);

  const patchWeather = useCallback((patch: Partial<Weather>) => {
    weatherSeriesRef.current = null; setWeatherSeries(null); setWeatherSource('manual');
    setWeather((current) => ({ ...current, ...patch }));
  }, []);
  // Secondary ignitions are read by the WebMCP tools outside React rendering, so
  // a ref is kept in step with the state, as for the primary ignition.
  const applyExtraIgnitions = useCallback((next: Ignition[] | ((current: Ignition[]) => Ignition[])) => {
    const value = typeof next === 'function' ? next(extraIgnitionsRef.current) : next;
    extraIgnitionsRef.current = value;
    setAdditionalIgnitions(value);
  }, []);
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }, []);
  const seekTimeline = useCallback((nextMinutes: number) => {
    setRunning(false);
    setMinutes(Math.max(0, Math.min(TIMELINE_MAX_MINUTES, Math.round(nextMinutes))));
  }, []);
  const logTool = useCallback((tool: string, label: string, state: Activity['state'] = 'done') => {
    const entry: Activity = { id: nextId(), tool, label, state, at: atNow() };
    setActivities((current) => [entry, ...current].slice(0, 14));
  }, []);
  const scrollPanelByKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const panel = event.currentTarget;
    const page = Math.max(80, Math.round(panel.clientHeight * 0.8));
    const target = event.key === 'ArrowDown' ? panel.scrollTop + 40
      : event.key === 'ArrowUp' ? panel.scrollTop - 40
        : event.key === 'PageDown' ? panel.scrollTop + page
          : event.key === 'PageUp' ? panel.scrollTop - page
            : event.key === 'Home' ? 0
              : event.key === 'End' ? panel.scrollHeight
                : null;
    if (target === null) return;
    event.preventDefault();
    panel.scrollTo({ top: target, behavior: 'auto' });
  }, []);
  const makePlan = useCallback((name: string, intention: string) => {
    const plan = emptyPlan(name, intention);
    setStagedPlan(plan);
    return plan;
  }, []);
  const stageUnit = useCallback((unit: Omit<Deployment, 'id' | 'staged'>) => {
    const deployment = { ...unit, id: nextId(), staged: true };
    setStagedPlan((current) => {
      const plan = current || emptyPlan();
      return { ...plan, deployments: [...plan.deployments, deployment] };
    });
    return deployment;
  }, []);
  const applyPlan = useCallback(() => {
    if (!stagedPlan) return false;
    setUndoStack((stack) => [...stack, { deployments: committed, firebreaks: committedFirebreaks }]);
    const moved = new Set(stagedPlan.movedFrom || []);
    setCommitted((current) => [
      ...current.filter((item) => !moved.has(item.id)),
      ...stagedPlan.deployments.map((item) => ({ ...item, staged: false })),
    ]);
    setCommittedFirebreaks((current) => [...current, ...stagedPlan.firebreaks]);
    setStagedPlan(null);
    setReviewOpen(false);
    reviewResolver.current?.(true);
    reviewResolver.current = null;
    notify('Plan applied. Every action remains reversible.');
    return true;
  }, [committed, committedFirebreaks, notify, stagedPlan]);
  const rejectPlan = useCallback(() => {
    setReviewOpen(false);
    reviewResolver.current?.(false);
    reviewResolver.current = null;
    notify('Plan rejected. The live situation was not changed.');
  }, [notify]);
  const revertPlan = useCallback(() => {
    let reverted = false;
    setUndoStack((stack) => {
      const previous = stack.at(-1);
      if (!previous) return stack;
      setCommitted(previous.deployments);
      setCommittedFirebreaks(previous.firebreaks);
      reverted = true;
      return stack.slice(0, -1);
    });
    notify('Last plan reverted.');
    return reverted;
  }, [notify]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setMinutes((value) => value + 5);
    }, Math.max(260, 1800 / speed));
    return () => window.clearInterval(timer);
  }, [running, speed]);

  useEffect(() => {
    let cancelled = false;
    import('maplibre-gl').then((maplibre) => {
      if (cancelled || !mapNode.current) return;
      maplibre.setWorkerUrl(MAPLIBRE_WORKER_URL);
      const map = new maplibre.Map({
        container: mapNode.current,
        style: BASEMAP_STYLE,
        center: [defaultIgnition.lng, defaultIgnition.lat], zoom: 11.2, maxZoom: MAP_MAX_ZOOM, attributionControl: false, cooperativeGestures: false,
      });
      const setupMapLayers = () => {
        if (!map.getSource('terrain-dem')) map.addSource('terrain-dem', {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          tileSize: 256, encoding: 'terrarium', maxzoom: 15,
        });
        // Three separate layers, oldest to liveliest: the area already burned,
        // the band still in flame, then the +3 h projection.
        map.addSource('fire', { type: 'geojson', data: engineGeoRef.current.perimeter as Parameters<GeoJSONSource['setData']>[0] });
        map.addLayer({ id: 'fire-fill', type: 'fill', source: 'fire', paint: { 'fill-color': '#7A2E1E', 'fill-opacity': 0.42 } });
        map.addLayer({ id: 'fire-line', type: 'line', source: 'fire', paint: { 'line-color': '#FF6B45', 'line-width': 1.6, 'line-opacity': 0.9 } });
        map.addSource('fire-active', { type: 'geojson', data: engineGeoRef.current.active as Parameters<GeoJSONSource['setData']>[0] });
        map.addLayer({ id: 'fire-active-fill', type: 'fill', source: 'fire-active', paint: { 'fill-color': '#FF7A18', 'fill-opacity': 0.55 } });
        map.addLayer({ id: 'fire-active-line', type: 'line', source: 'fire-active', paint: { 'line-color': '#FFC53D', 'line-width': 2.2, 'line-opacity': 0.95, 'line-blur': 1.2 } });
        map.addSource('fire-extinguished', { type: 'geojson', data: engineGeoRef.current.extinguished as Parameters<GeoJSONSource['setData']>[0] });
        map.addLayer({ id: 'fire-extinguished-line', type: 'line', source: 'fire-extinguished', paint: { 'line-color': '#B8B8B8', 'line-width': 1.5, 'line-opacity': 0.85, 'line-dasharray': [2, 2] } });
        map.addSource('fire-forecast', { type: 'geojson', data: engineGeoRef.current.forecast as Parameters<GeoJSONSource['setData']>[0] });
        map.addLayer({ id: 'fire-forecast-line', type: 'line', source: 'fire-forecast', paint: { 'line-color': '#FF3B30', 'line-width': 1.8, 'line-opacity': 0.8, 'line-dasharray': [3, 2] } });
        map.addSource('operational-lines', { type: 'geojson', data: emptyGeoJSON });
        map.addLayer({ id: 'operational-lines-held', type: 'line', source: 'operational-lines', filter: ['==', ['get', 'tacticalBurn'], false], paint: { 'line-color': '#E2E2E2', 'line-width': 2.4, 'line-opacity': ['case', ['get', 'staged'], 0.45, 0.95], 'line-dasharray': [4, 2] } });
        map.addLayer({ id: 'operational-lines-burn', type: 'line', source: 'operational-lines', filter: ['==', ['get', 'tacticalBurn'], true], paint: { 'line-color': '#FF7A18', 'line-width': 3, 'line-opacity': ['case', ['get', 'staged'], 0.45, 0.95], 'line-dasharray': [2, 1] } });
        setMapReady(true);
      };
      // The fire must render even when the basemap does not answer.
      if (map.isStyleLoaded()) setupMapLayers(); else map.once('style.load', setupMapLayers);
      let anchor: { lng: number; lat: number } | null = null;
      const metresBetween = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => {
        const latMean = ((a.lat + b.lat) / 2) * Math.PI / 180;
        return Math.hypot((b.lng - a.lng) * 111320 * Math.cos(latMean), (b.lat - a.lat) * 111320);
      };
      map.on('mousedown', (event) => {
        if (!pickingRef.current) return;
        event.preventDefault();
        anchor = { lng: event.lngLat.lng, lat: event.lngLat.lat };
        setDraftIgnition({ ...anchor, radiusM: 0 });
      });
      map.on('mousemove', (event) => {
        if (!anchor) return;
        setDraftIgnition({ ...anchor, radiusM: Math.min(6000, metresBetween(anchor, event.lngLat)) });
      });
      map.on('mouseup', (event) => {
        if (!anchor) return;
        const radiusM = Math.min(6000, metresBetween(anchor, event.lngLat));
        const placed = { ...anchor, radiusM };
        anchor = null;
        setDraftIgnition(null);
        if (ignitionRef.current) {
          applyExtraIgnitions((current) => [...current, placed].slice(0, MAX_EXTRA_IGNITIONS));
          notify('Secondary ignition set. Spread restarts from every ignition point.');
        } else {
          setIgnition(placed); ignitionRef.current = placed;
          notify('Primary ignition placed.');
        }
        setPickingIgnition(false);
      });
      mapRef.current = map;
    }).catch(() => undefined);
    return () => { cancelled = true; setMapReady(false); mapRef.current?.remove(); mapRef.current = null; };
  }, [applyExtraIgnitions, notify]);

  useEffect(() => {
    const controller = new AbortController();
    weatherSeriesRef.current = null;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setWeatherSeries(null); setWeatherSource(incident.startDate && incident.endDate ? 'loading' : 'manual');
    });
    if (!incident.startDate || !incident.endDate) return () => controller.abort();
    const query = new URLSearchParams({
      latitude: String(domain.lat), longitude: String(domain.lng), start_date: incident.startDate, end_date: incident.endDate,
      hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m',
      timezone: 'Europe/Paris', wind_speed_unit: 'kmh',
    });
    fetch(`https://archive-api.open-meteo.com/v1/archive?${query}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(`Open-Meteo ${response.status}`); return response.json(); })
      .then((payload) => {
        const hourly = (payload as { hourly?: { temperature_2m?: number[]; relative_humidity_2m?: number[]; wind_speed_10m?: number[]; wind_direction_10m?: number[] } }).hourly;
        const temperatures = hourly?.temperature_2m, humidities = hourly?.relative_humidity_2m;
        const winds = hourly?.wind_speed_10m, bearings = hourly?.wind_direction_10m;
        if (!temperatures?.length || !humidities?.length || !winds?.length || !bearings?.length) throw new Error('Incomplete hourly series');
        const offset = incident.startHour + incident.startMinute / 60;
        const series = temperatures.map((temperature, index) => ({
          hourFromStart: index - offset, temperature,
          humidity: humidities[index],
          windKph: winds[index],
          // Open-Meteo gives the meteorological origin; FireNow stores the spread bearing.
          windBearingDegrees: (bearings[index] + 180) % 360,
        }));
        if (controller.signal.aborted) return;
        weatherSeriesRef.current = series; setWeatherSeries(series); setWeatherSource('open-meteo');
        const initial = series[Math.max(0, Math.ceil(offset))];
        if (initial) {
          const compass = COMPASS[Math.round(initial.windBearingDegrees / 45) % 8];
          setWeather((current) => ({ ...current, temperature: Math.round(initial.temperature), humidity: Math.round(initial.humidity),
            windSpeed: Math.round(initial.windKph), gusts: Math.max(current.gusts, Math.round(initial.windKph * 1.4)),
            windBearing: initial.windBearingDegrees, windDirection: compass.from }));
        }
      })
      .catch((error) => { if (error instanceof DOMException && error.name === 'AbortError') return; setWeatherSource('error'); });
    return () => controller.abort();
  }, [domain.lat, domain.lng, incident.endDate, incident.startDate, incident.startHour, incident.startMinute]);

  useEffect(() => {
    const worker = new Worker('/simulation.worker.js');
    simulationWorker.current = worker;
    return () => {
      worker.terminate();
      simulationWorker.current = null;
    };
  }, []);

  const runWorker = useCallback((payload: Record<string, unknown>) => {
    const worker = simulationWorker.current;
    if (!worker) return Promise.reject(new Error('Moteur de simulation indisponible.'));
    const requestId = nextId();
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const onMessage = (event: MessageEvent) => {
        if (event.data?.id !== requestId) return;
        worker.removeEventListener('message', onMessage);
        if (event.data.ok) resolve(event.data.result);
        else reject(new Error(event.data.error || 'Engine error.'));
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({ ...payload, landscape: landscapeRef.current, weatherSeries: weatherSeriesRef.current, id: requestId });
    });
  }, []);

  const applyEngineResult = useCallback((engine: Record<string, unknown>) => {
    const perimeter = engine.perimeterGeoJSON || emptyGeoJSON;
    const forecast = engine.forecastPerimeterGeoJSON || emptyGeoJSON;
    const active = engine.activeFrontGeoJSON || emptyGeoJSON;
    const extinguished = engine.extinguishedEdgeGeoJSON || emptyGeoJSON;
    engineGeoRef.current = { perimeter, active, extinguished, forecast };
    setBurnedHa(Number(engine.totalBurnedHa));
    setFrontRate(Number(engine.rateOfSpreadMetersPerMinute));
    setSuppression((engine.suppression as Suppression) ?? null);
    setPerimeterGeoJSON(perimeter);
    setForecastGeoJSON(forecast);
    setActiveGeoJSON(active);
    setExtinguishedGeoJSON(extinguished);
    setComposition(Array.isArray(engine.fuelComposition) ? engine.fuelComposition.slice(0, 4) : []);
    setExposure((engine.exposure as Exposure) || null);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const shownIgnitions = [...(ignition ? [ignition] : []), ...additionalIgnitions, ...(draftIgnition ? [draftIgnition] : [])];
    if (shownIgnitions.length === 0) return;
    const ignitionMarkers: Marker[] = [];
    let cancelled = false;
    import('maplibre-gl').then((maplibre) => {
      if (cancelled || !mapRef.current) return;
      shownIgnitions.forEach((shown, index) => {
        const node = document.createElement('div');
        node.className = 'ignition-marker' + (index === 0 ? ' primary' : ' secondary');
        node.dataset.label = String(index + 1);
        node.title = index === 0 ? 'Main ignition' : `Secondary ignition ${index}`;
        node.setAttribute('role', 'img');
        node.setAttribute('aria-label', node.title);
        if (shown.radiusM > 0) {
          const halo = document.createElement('i');
          const metresPerPixel = 40075016.686 * Math.cos(shown.lat * Math.PI / 180) / (256 * Math.pow(2, mapRef.current!.getZoom()));
          const diameter = Math.max(13, (shown.radiusM * 2) / metresPerPixel);
          halo.style.width = diameter + 'px'; halo.style.height = diameter + 'px';
          node.appendChild(halo);
        }
        ignitionMarkers.push(new maplibre.Marker({ element: node }).setLngLat([shown.lng, shown.lat]).addTo(mapRef.current!));
      });
    }).catch(() => undefined);
    return () => { cancelled = true; ignitionMarkers.forEach((marker) => marker.remove()); };
  }, [additionalIgnitions, ignition, draftIgnition, mapReady, viewMode]);

  useEffect(() => {
    const fireSource = mapRef.current?.getSource('fire') as GeoJSONSource | undefined;
    const forecastSource = mapRef.current?.getSource('fire-forecast') as GeoJSONSource | undefined;
    const activeSource = mapRef.current?.getSource('fire-active') as GeoJSONSource | undefined;
    const extinguishedSource = mapRef.current?.getSource('fire-extinguished') as GeoJSONSource | undefined;
    fireSource?.setData((ignition ? perimeterGeoJSON : emptyGeoJSON) as Parameters<GeoJSONSource['setData']>[0]);
    forecastSource?.setData((ignition ? forecastGeoJSON : emptyGeoJSON) as Parameters<GeoJSONSource['setData']>[0]);
    activeSource?.setData((ignition ? activeGeoJSON : emptyGeoJSON) as Parameters<GeoJSONSource['setData']>[0]);
    extinguishedSource?.setData((ignition ? extinguishedGeoJSON : emptyGeoJSON) as Parameters<GeoJSONSource['setData']>[0]);
  }, [forecastGeoJSON, perimeterGeoJSON, activeGeoJSON, extinguishedGeoJSON, ignition]);

  useEffect(() => {
    const source = mapRef.current?.getSource('operational-lines') as GeoJSONSource | undefined;
    if (!source) return;
    const staged = stagedPlan?.firebreaks || [];
    source.setData({
      type: 'FeatureCollection',
      features: [...committedFirebreaks.map((line) => ({ line, staged: false })), ...staged.map((line) => ({ line, staged: true }))].map(({ line, staged: isStaged }) => ({
        type: 'Feature',
        properties: { name: line.name, staged: isStaged, tacticalBurn: Boolean(line.tacticalBurn) },
        geometry: { type: 'LineString', coordinates: line.coordinates },
      })),
    } as Parameters<GeoJSONSource['setData']>[0]);
  }, [committedFirebreaks, mapReady, stagedPlan?.firebreaks]);

  useEffect(() => {
    // Blank map: clear the ref (read by the 'load' handler) without touching
    // state, since the displayed values are derived further down.
    if (!ignition) { engineGeoRef.current = { perimeter: emptyGeoJSON, active: emptyGeoJSON, extinguished: emptyGeoJSON, forecast: emptyGeoJSON }; return; }
    runWorker({
      type: 'simulate', ignitionLngLat: ignition, extraIgnitions: additionalIgnitions, reset: true, targetMinutes: minutes,
      temperature: weather.temperature, humidity: weather.humidity, droughtIndex: weather.droughtIndex,
      plumeDriven: weather.plumeDriven === true, domain, terrain,
      windKph: weather.windSpeed, windDirection: weather.windDirection, windBearingDegrees: weather.windBearing,
      startHour: incident.startHour + incident.startMinute / 60,
      slopeDegrees: 7.4, deployments: committed, firebreaks: committedFirebreaks, includeForecast: true,
    }).then(applyEngineResult).catch(() => undefined);
  }, [additionalIgnitions, applyEngineResult, committed, committedFirebreaks, minutes, runWorker, weather.windDirection, weather.windSpeed, weather.windBearing, weather.temperature, weather.humidity, weather.droughtIndex, weather.plumeDriven, domain, terrain, ignition, incident, landscapeAsset, weatherSeries]);

  // Simulation switch: freeze the current one into the list, then load the target.
  const switchScenario = useCallback((id: string) => {
    setRunning(false);
    setScenarios((list) => list.map((item) => item.id === activeScenario
      ? { ...item, ignition, minutes, weather, committed, firebreaks: committedFirebreaks, domain, terrain, burnedHa }
      : item));
    const target = scenarios.find((item) => item.id === id);
    if (!target) return;
    setActiveScenario(id);
    setIgnition(target.ignition); ignitionRef.current = target.ignition;
    applyExtraIgnitions([]);
    setMinutes(target.minutes); setWeather(target.weather); setCommitted(target.committed); setCommittedFirebreaks(target.firebreaks);
    setDomain(target.domain); setTerrain(target.terrain); setIncident(target.incident);
    mapRef.current?.jumpTo({ center: [target.domain.lng, target.domain.lat], zoom: target.domain.boxMetres > 35000 ? 10.1 : 11.2 });
    setStagedPlan(null); setUndoStack([]); setPickingIgnition(false);
  }, [activeScenario, applyExtraIgnitions, burnedHa, committed, committedFirebreaks, domain, terrain, ignition, minutes, scenarios, weather]);

  const createScenario = useCallback((preset: 'blank' | 'saumos' | 'etoile' | 'bug' = 'blank') => {
    setRunning(false);
    const NAMES: Record<string, string> = {
      saumos: 'Saumos · 22 Jul 2026', etoile: 'Marseille · Étoile massif', bug: 'Bug Fire · 8 Aug 2026',
    };
    const created = preset === 'blank'
      ? makeScenario('Simulation ' + String(scenarios.length + 1), 'blank')
      : makeScenario(NAMES[preset], preset);
    setScenarios((list) => list.map((item) => item.id === activeScenario
      ? { ...item, ignition, minutes, weather, committed, firebreaks: committedFirebreaks, domain, terrain, burnedHa }
      : item).concat(created));
    setActiveScenario(created.id);
    setIgnition(created.ignition); ignitionRef.current = created.ignition;
    applyExtraIgnitions([]);
    setMinutes(created.minutes); setWeather(created.weather); setCommitted(created.committed); setCommittedFirebreaks(created.firebreaks);
    setDomain(created.domain); setTerrain(created.terrain); setIncident(created.incident);
    mapRef.current?.jumpTo({ center: [created.domain.lng, created.domain.lat], zoom: created.domain.boxMetres > 35000 ? 10.1 : 11.2 });
    setStagedPlan(null); setUndoStack([]); setPickingIgnition(preset === 'blank');
    const NOTES: Record<string, string> = {
      saumos: 'Saumos fire, 22 July 2026 \u2014 47,004 ha burned, 220,000 people evacuated.',
      etoile: 'Étoile massif \u2014 mistral exercise, garrigue and Aleppo pine. This is not a historical fire.',
      bug: 'Bug Fire, 8 August 2026 \u2014 sagebrush and pinyon-juniper, 93,733 acres burned.',
      blank: 'New simulation. Place the ignition point to start.',
    };
    notify(NOTES[preset]);
  }, [activeScenario, applyExtraIgnitions, burnedHa, committed, committedFirebreaks, domain, terrain, ignition, minutes, notify, scenarios.length, weather]);

  // The displayed list derives from live state for the open simulation.
  const scenarioList = scenarios.map((item) => item.id === activeScenario
    ? { ...item, ignition, minutes, weather, committed, firebreaks: committedFirebreaks, burnedHa }
    : item);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    import('maplibre-gl').then((maplibre) => {
      if (cancelled || !mapRef.current) return;
      const map = mapRef.current;
      const deployments = [...committed, ...(stagedPlan?.deployments || [])];
      const renderMarkers = () => {
        if (cancelled || !mapRef.current) return;
        const zoom = map.getZoom();
        // Above the threshold every unit shows on its own; below it they are
        // clustered into screen tiles whose size follows the zoom.
        const bucketSize = zoom < 5 ? 118 : zoom < 8 ? 94 : 76;
        const buckets = new globalThis.Map<string, Deployment[]>();
        deployments.forEach((unit) => {
          const point = map.project([unit.lng, unit.lat]);
          const bucket = zoom >= UNIT_CLUSTER_ZOOM ? unit.id : `${Math.round(point.x / bucketSize)}:${Math.round(point.y / bucketSize)}`;
          buckets.set(bucket, [...(buckets.get(bucket) || []), unit]);
        });
        const wanted = new Set<string>();
        [...buckets.values()].forEach((group) => {
          const center: [number, number] = [
            group.reduce((sum, unit) => sum + unit.lng, 0) / group.length,
            group.reduce((sum, unit) => sum + unit.lat, 0) / group.length,
          ];
          if (group.length > 1) {
            const total = group.reduce((sum, unit) => sum + unit.count, 0);
            const staged = group.some((unit) => unit.staged);
            // The key carries everything drawn: a cluster of identical make-up
            // keeps its marker instead of being redrawn.
            const key = 'c|' + group.map((unit) => unit.id).sort().join(',') + '|' + total + '|' + staged;
            wanted.add(key);
            const existing = markersRef.current.get(key);
            if (existing) { existing.marker.setLngLat(center); return; }
            const element = document.createElement('button');
            element.type = 'button';
            element.className = 'unit-cluster' + (staged ? ' has-staged' : '');
            element.title = `${group.length} groups · ${total} units. Click to zoom in.`;
            element.setAttribute('aria-label', element.title);
            const root = createRoot(element);
            root.render(<><strong>{total}</strong><small>{group.length} groupes</small></>);
            element.addEventListener('click', (event) => {
              event.stopPropagation();
              // Zoom is re-read on click: the marker outlives map moves.
              map.easeTo({ center, zoom: Math.min(11.2, map.getZoom() + 2.6), duration: 520 });
            });
            markersRef.current.set(key, { marker: new maplibre.Marker({ element }).setLngLat(center).addTo(map), root });
            return;
          }
          const unit = group[0];
          const key = 'u|' + unit.id + '|' + unit.type + '|' + unit.count + '|' + unit.staged;
          wanted.add(key);
          const kept = markersRef.current.get(key);
          if (kept) {
            kept.marker.setLngLat([unit.lng, unit.lat]);
            kept.marker.setDraggable(zoom >= UNIT_CLUSTER_ZOOM);
            return;
          }
          const catalogueUnit = units.find((item) => item.code === unit.type);
          const UnitIcon = UNIT_ICONS[unit.type] || Truck;
          const familyClass = catalogueUnit ? unitFamilyClass(catalogueUnit.family) : 'ground';
          const element = document.createElement('button');
          element.type = 'button';
          element.className = 'unit-marker fam-' + familyClass + (unit.staged ? ' ghost' : '');
          element.title = unit.type + ' × ' + unit.count + ' · ' + unit.mission;
          element.setAttribute('aria-label', element.title);
          const root = createRoot(element);
          root.render(<><UnitIcon size={16} strokeWidth={1.9} aria-hidden="true" /><b>{unit.type}</b><span>{String(unit.count).padStart(2, '0')}</span></>);
          const marker = new maplibre.Marker({ element, draggable: zoom >= UNIT_CLUSTER_ZOOM }).setLngLat([unit.lng, unit.lat]).addTo(map);
          marker.on('dragend', () => {
            const { lng, lat } = marker.getLngLat();
            // Moving an already-committed unit goes through the draft plan: the
            // "one approval per batch" rule covers manual gestures too.
            if (unit.staged) {
              setStagedPlan((plan) => plan
                ? { ...plan, deployments: plan.deployments.map((item) => item.id === unit.id ? { ...item, lng, lat } : item) }
                : plan);
            } else {
              setStagedPlan((plan) => {
                const base = plan || emptyPlan('Manual redeployment', 'Move a unit that is already committed.');
                const already = base.deployments.some((item) => item.id === unit.id);
                return already
                  ? { ...base, deployments: base.deployments.map((item) => item.id === unit.id ? { ...item, lng, lat } : item) }
                  : { ...base, deployments: [...base.deployments, { ...unit, lng, lat, staged: true }], movedFrom: [...(base.movedFrom || []), unit.id] };
              });
              notify(unit.type + ' moved inside the draft plan. Commit to make it real.');
            }
          });
          markersRef.current.set(key, { marker, root });
        });
        // Only wanted markers remain: the others leave with their React root,
        // without disturbing the ones that did not change.
        markersRef.current.forEach((entry, key) => {
          if (wanted.has(key)) return;
          entry.marker.remove();
          unmountLater(entry.root);
          markersRef.current.delete(key);
        });
      };
      renderMarkers();
      map.on('moveend', renderMarkers);
      dispose = () => map.off('moveend', renderMarkers);
    }).catch(() => undefined);
    return () => { cancelled = true; dispose?.(); };
  }, [committed, mapReady, notify, stagedPlan?.deployments, viewMode]);

  // Markers outlive renders: only tearing the component down removes them for
  // good.
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      markers.forEach((entry) => { entry.marker.remove(); unmountLater(entry.root); });
      markers.clear();
    };
  }, []);

  const comparePlansWithWorker = useCallback(async (names: string[], horizonHours: number) => {
    if (names.length !== 3) throw new Error('compare_plans requires exactly three strategies.');
    const placementSets: Deployment[][] = [
      [{ id: nextId(), type: 'CCF', count: 12, sector: 'South-east', mission: 'Intercept the fire head', lng: -0.446, lat: 44.5825, radiusM: 1200, capacity: 0.09, staged: true }, { id: nextId(), type: 'DOZ', count: 3, sector: 'East', mission: 'Control line', lng: -0.438, lat: 44.586, radiusM: 700, capacity: 0.07, staged: true }],
      [{ id: nextId(), type: 'CCF', count: 6, sector: 'North', mission: 'Hold the north flank', lng: -0.4541, lat: 44.597, radiusM: 900, capacity: 0.09, staged: true }, { id: nextId(), type: 'CCF', count: 6, sector: 'South', mission: 'Hold the south flank', lng: -0.449, lat: 44.584, radiusM: 900, capacity: 0.09, staged: true }],
      [],
    ];
    const engineRuns = await Promise.all(placementSets.map((deployments) => {
      return runWorker({
        type: 'simulate', ignitionLngLat: ignitionRef.current, extraIgnitions: extraIgnitionsRef.current, independent: true, targetMinutes: horizonHours * 60,
        temperature: stateRef.current.weather.temperature, humidity: stateRef.current.weather.humidity,
        droughtIndex: stateRef.current.weather.droughtIndex, windBearingDegrees: stateRef.current.weather.windBearing,
        plumeDriven: stateRef.current.weather.plumeDriven === true, domain: stateRef.current.domain, terrain: stateRef.current.terrain,
        windKph: stateRef.current.weather.windSpeed, windDirection: stateRef.current.weather.windDirection,
        startHour: stateRef.current.incident.startHour + stateRef.current.incident.startMinute / 60,
        slopeDegrees: 7.4, deployments, firebreaks: stateRef.current.committedFirebreaks,
      });
    }));
    const results = names.map((name, index): StrategyResult => ({
      name, description: planDescriptions[index], deployments: placementSets[index],
      resources: placementSets[index].reduce((sum, deployment) => sum + deployment.count, 0),
      burnedHa: Number(engineRuns[index].totalBurnedHa),
      rateOfSpread: Number(engineRuns[index].rateOfSpreadMetersPerMinute),
    })).sort((a, b) => a.burnedHa - b.burnedHa);
    setStagedPlan((plan) => ({ ...(plan || emptyPlan(results[0].name, 'Protect the village after the wind shift.')), comparison: results }));
    setComparisonOpen(true);
    return { horizonHours, strategies: results, recommended: results[0].name, model: 'Rothermel 1972 + Alexander 1985', workerCalls: engineRuns.length };
  }, [runWorker]);

  const changeView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    const map = mapRef.current;
    if (mode === 'globe') {
      map?.setTerrain(null);
      map?.setProjection({ type: 'globe' });
      map?.flyTo({ center: [(ignitionRef.current ?? defaultIgnition).lng, (ignitionRef.current ?? defaultIgnition).lat], zoom: 3.2, pitch: 0, duration: 1100 });
    } else if (mode === '3D') {
      map?.setProjection({ type: 'mercator' });
      map?.setTerrain({ source: 'terrain-dem', exaggeration: 1.35 });
      map?.easeTo({ center: [(ignitionRef.current ?? defaultIgnition).lng, (ignitionRef.current ?? defaultIgnition).lat], zoom: 11.2, pitch: 62, bearing: -18, duration: 900 });
    } else {
      map?.setTerrain(null);
      map?.setProjection({ type: 'mercator' });
      map?.easeTo({ center: [(ignitionRef.current ?? defaultIgnition).lng, (ignitionRef.current ?? defaultIgnition).lat], zoom: 11.2, pitch: 0, bearing: 0, duration: 700 });
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    const detectModelContext = () => {
      const modelContext = document.modelContext as ModelContextLike | undefined;
      if (!modelContext || typeof modelContext.registerTool !== 'function') return false;
      if (!stopped) setModelContextReady(true);
      return true;
    };
    if (detectModelContext()) return () => { stopped = true; };
    const detector = window.setInterval(() => {
      if (!detectModelContext()) return;
      window.clearInterval(detector);
    }, 250);
    const giveUp = window.setTimeout(() => window.clearInterval(detector), 5000);
    return () => {
      stopped = true;
      window.clearInterval(detector);
      window.clearTimeout(giveUp);
    };
  }, []);

  useEffect(() => {
    if (!modelContextReady) return;
    const mc = document.modelContext as ModelContextLike | undefined;
    if (!mc || typeof mc.registerTool !== 'function') return;
    const readOnly = { readOnlyHint: true };
    const mutating = { readOnlyHint: false };
    const requireStagedPlan = () => {
      const plan = stateRef.current.stagedPlan;
      if (!plan) throw new Error('No draft plan is open. Call propose_plan first, then retry this action.');
      return plan;
    };
    const defs: ToolDefinition[] = [
      {
        name: 'get_situation', title: 'Read the operational situation',
        description: 'Returns a compact JSON state of the fire, the weather, the committed units and the exposed areas. Call this before making any recommendation.',
        inputSchema: schema({}), annotations: readOnly,
        execute: () => {
          const s = stateRef.current;
          const currentScenario = s.scenarios.find((item) => item.id === s.activeScenario);
          return { scenario: currentScenario ? { id: currentScenario.id, preset: currentScenario.preset, name: currentScenario.name } : null, incident: s.incident, minutesFromIgnition: s.minutes, burnedHa: s.burnedHa, rateOfSpreadMetersPerMinute: s.frontRate, weather: s.weather, engagedUnits: s.committed, calibrationStatus: 'not_performed' };
        },
      },
      {
        name: 'list_units', title: 'List the units',
        description: 'Lists available and committed units with position, status, capacity and sustainable duty.',
        inputSchema: schema({}), annotations: readOnly, execute: () => ({ available: units, engaged: stateRef.current.committed }),
      },
      {
        name: 'get_fire_forecast', title: 'Project the fire front',
        description: 'Projects the fire at T+1h, T+3h and T+6h under the current weather.',
        inputSchema: schema({}), annotations: readOnly,
        execute: async () => {
          const projections = await Promise.all([1, 3, 6].map(async (hours) => {
            const result = await runWorker({ type: 'simulate', ignitionLngLat: ignitionRef.current, extraIgnitions: extraIgnitionsRef.current, independent: true, targetMinutes: hours * 60, temperature: stateRef.current.weather.temperature, humidity: stateRef.current.weather.humidity, droughtIndex: stateRef.current.weather.droughtIndex, windBearingDegrees: stateRef.current.weather.windBearing, plumeDriven: stateRef.current.weather.plumeDriven === true, domain: stateRef.current.domain, terrain: stateRef.current.terrain, windKph: stateRef.current.weather.windSpeed, windDirection: stateRef.current.weather.windDirection, startHour: stateRef.current.incident.startHour + stateRef.current.incident.startMinute / 60, slopeDegrees: 7.4, deployments: stateRef.current.committed, firebreaks: stateRef.current.committedFirebreaks });
            return { horizon: 'T+' + hours + 'h', burnedHa: result.totalBurnedHa, rateOfSpreadMetersPerMinute: result.rateOfSpreadMetersPerMinute, perimeterBounds: result.bounds };
          }));
          return { model: 'Rothermel 1972 + Alexander 1985', projections, calibrationStatus: 'not_performed' };
        },
      },
      {
        name: 'get_weather', title: 'Read the weather', description: 'Returns wind, gusts, temperature, relative humidity and drought index.',
        inputSchema: schema({}), annotations: readOnly, execute: () => stateRef.current.weather,
      },
      {
        name: 'query_terrain', title: 'Query the terrain', description: 'Analyses slope, aspect, fuel model and road access for a sector.',
        inputSchema: schema({ sector: { type: 'string', maxLength: 80 } }, ['sector']), annotations: readOnly,
        execute: (input) => ({ sector: textValue(input.sector, 'sector', 80), slopePercent: 7.4, aspect: 'south-east', fuel: 'Maritime pine · Scott & Burgan TU5', roadAccess: 'D115 and DFCI track P-17', dataSource: 'scenario-mask' }),
      },
      {
        name: 'list_scenarios', title: 'List the scenarios', description: 'Lists the available scenarios and their calibration status.',
        inputSchema: schema({}), annotations: readOnly,
        execute: () => {
          const s = stateRef.current;
          return {
            scenarios: scenarioPresets.map((preset) => {
              const instances = s.scenarios.filter((item) => item.preset === preset.id);
              return {
                id: preset.id,
                name: preset.name,
                kind: preset.kind,
                status: instances.some((item) => item.id === s.activeScenario) ? 'active' : 'available',
                calibrationStatus: 'not_performed',
                liveInstances: instances.map((item) => ({ id: item.id, name: item.name })),
              };
            }),
          };
        },
      },
      {
        name: 'propose_plan', title: 'Open a draft plan',
        description: 'Opens a ghost proposal layer. Never modifies the live simulation.',
        inputSchema: schema({ name: { type: 'string', maxLength: 80 }, intention: { type: 'string', maxLength: 300 } }, ['name', 'intention']), annotations: mutating,
        execute: (input) => {
          const plan = makePlan(textValue(input.name, 'name', 80), textValue(input.intention, 'intention', 300));
          return { staged: true, plan, planSummary: summarizePlan(plan), liveSimulationChanged: false };
        },
      },
      {
        name: 'stage_deploy_units', title: 'Stage units',
        description: 'Stages up to 50 units from the available fleet in the draft plan. Commits nothing. Call list_units first to choose unit codes and positions.',
        inputSchema: schema({ units: { type: 'array', minItems: 1, maxItems: 50, items: schema({
          type: { type: 'string', enum: UNIT_CODES }, count: { type: 'integer', minimum: 1, maximum: 50 },
          sector: { type: 'string', maxLength: 80 }, mission: { type: 'string', maxLength: 160 },
          lng: { type: 'number', minimum: -180, maximum: 180 }, lat: { type: 'number', minimum: -90, maximum: 90 },
          radiusM: { type: 'number', minimum: 100, maximum: 5000 },
        }, ['type', 'count', 'sector', 'mission', 'lng', 'lat', 'radiusM']) } }, ['units']), annotations: mutating,
        execute: (input) => {
          const plan = requireStagedPlan();
          if (!Array.isArray(input.units) || input.units.length < 1 || input.units.length > 50) throw new Error('Field "units" must be an array of 1 to 50 unit groups.');
          const deployments = input.units.map((raw, index) => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Item units[${index}] must be an object describing a unit group.`);
            const item = raw as Record<string, unknown>;
            const type = textValue(item.type, 'type', 5);
            if (!UNIT_CODES.includes(type)) throw new Error(`Unit type "${type}" is not supported. Call list_units and use one of the returned unit codes.`);
            return { type, count: numberValue(item.count, 'count', 1, 50), sector: textValue(item.sector, 'sector', 80), mission: textValue(item.mission, 'mission', 160), lng: numberValue(item.lng, 'lng', -180, 180), lat: numberValue(item.lat, 'lat', -90, 90), radiusM: numberValue(item.radiusM, 'radiusM', 100, 5000), capacity: unitSuppressionCapacity(type), id: nextId(), staged: true };
          });
          const requestedUnits = deployments.reduce((sum, item) => sum + item.count, 0);
          const resultingUnits = summarizePlan(plan).totalUnits + requestedUnits;
          if (resultingUnits > 50) throw new Error(`This batch would take the plan to ${resultingUnits} units; 50 is the maximum. Reduce the "count" values by at least ${resultingUnits - 50}.`);
          const nextPlan = { ...plan, deployments: [...plan.deployments, ...deployments] };
          setStagedPlan(nextPlan);
          return { staged: true, deployments, planSummary: summarizePlan(nextPlan), liveSimulationChanged: false };
        },
      },
      {
        name: 'stage_assign_task', title: 'Stage a task', description: 'Assigns a mission without touching the live simulation.',
        inputSchema: schema({ unitId: { type: 'string', maxLength: 80 }, mission: { type: 'string', maxLength: 180 } }, ['unitId', 'mission']), annotations: mutating,
        execute: (input) => {
          const plan = requireStagedPlan();
          const task = { unitId: textValue(input.unitId, 'unitId', 80), mission: textValue(input.mission, 'mission', 180) };
          const nextPlan = { ...plan, tasks: [...plan.tasks, task] };
          setStagedPlan(nextPlan);
          return { staged: true, task, planSummary: summarizePlan(nextPlan), liveSimulationChanged: false };
        },
      },
      {
        name: 'stage_firebreak', title: 'Draw a control line', description: 'Adds a draft geographic polyline. Once committed it becomes a persistent break in the engine.',
        inputSchema: schema({ name: { type: 'string', maxLength: 80 }, sector: { type: 'string', maxLength: 80 }, coordinates: { type: 'array', minItems: 2, maxItems: 64, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } }, widthM: { type: 'number', minimum: 2, maximum: 80 }, staffed: { type: 'boolean' } }, ['name','sector','coordinates']), annotations: mutating,
        execute: (input) => {
          const plan = requireStagedPlan();
          if (!Array.isArray(input.coordinates) || input.coordinates.length < 2 || input.coordinates.length > 64) throw new Error('Field "coordinates" must hold between 2 and 64 [longitude, latitude] points.');
          const coordinates = input.coordinates.map((raw, index) => {
            if (!Array.isArray(raw) || raw.length !== 2) throw new Error(`Point coordinates[${index}] must be exactly [longitude, latitude].`);
            return [numberValue(raw[0], 'longitude', -180, 180), numberValue(raw[1], 'latitude', -90, 90)] as [number, number];
          });
          const lengthKm = coordinates.slice(1).reduce((sum, point, index) => {
            const previous = coordinates[index];
            const lat = (point[1] + previous[1]) * Math.PI / 360;
            return sum + Math.hypot((point[0] - previous[0]) * 111.32 * Math.cos(lat), (point[1] - previous[1]) * 111.32);
          }, 0);
          const line: Firebreak = { name: textValue(input.name, 'name', 80), sector: textValue(input.sector, 'sector', 80), coordinates, lengthKm: Number(lengthKm.toFixed(2)), widthM: input.widthM === undefined ? 12 : numberValue(input.widthM, 'widthM', 2, 80), staffed: input.staffed !== false };
          const nextPlan = { ...plan, firebreaks: [...plan.firebreaks, line] };
          setStagedPlan(nextPlan);
          return { staged: true, firebreak: line, planSummary: summarizePlan(nextPlan), liveSimulationChanged: false };
        },
      },
      {
        name: 'stage_tactical_burn', title: 'Prepare a tactical burn', description: 'Draws a held line and prepares a deliberate ignition on the fire side. Nothing is lit before human approval.',
        inputSchema: schema({ name: { type: 'string', maxLength: 80 }, sector: { type: 'string', maxLength: 80 }, coordinates: { type: 'array', minItems: 2, maxItems: 64, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } }, widthM: { type: 'number', minimum: 2, maximum: 80 } }, ['name','sector','coordinates']), annotations: mutating,
        execute: (input) => {
          const plan = requireStagedPlan();
          if (!Array.isArray(input.coordinates) || input.coordinates.length < 2 || input.coordinates.length > 64) throw new Error('Field "coordinates" must hold between 2 and 64 [longitude, latitude] points.');
          const coordinates = input.coordinates.map((raw, index) => {
            if (!Array.isArray(raw) || raw.length !== 2) throw new Error(`Point coordinates[${index}] must be exactly [longitude, latitude].`);
            return [numberValue(raw[0], 'longitude', -180, 180), numberValue(raw[1], 'latitude', -90, 90)] as [number, number];
          });
          const lengthKm = coordinates.slice(1).reduce((sum, point, index) => {
            const previous = coordinates[index];
            const lat = (point[1] + previous[1]) * Math.PI / 360;
            return sum + Math.hypot((point[0] - previous[0]) * 111.32 * Math.cos(lat), (point[1] - previous[1]) * 111.32);
          }, 0);
          const line: Firebreak = { name: textValue(input.name, 'name', 80), sector: textValue(input.sector, 'sector', 80), coordinates, lengthKm: Number(lengthKm.toFixed(2)), widthM: input.widthM === undefined ? 12 : numberValue(input.widthM, 'widthM', 2, 80), staffed: true, tacticalBurn: true };
          const nextPlan = { ...plan, firebreaks: [...plan.firebreaks, line] };
          setStagedPlan(nextPlan);
          return { staged: true, tacticalBurn: line, planSummary: summarizePlan(nextPlan), ignitionCommitted: false, liveSimulationChanged: false };
        },
      },
      {
        name: 'stage_evacuation_zone', title: 'Prepare an evacuation zone',
        description: 'Outlines a draft zone. No order is ever transmitted.',
        inputSchema: schema({ name: { type: 'string', maxLength: 80 }, sector: { type: 'string', maxLength: 80 }, population: { type: 'integer', minimum: 0, maximum: 100000 } }, ['name','sector','population']), annotations: mutating,
        execute: (input) => {
          const plan = requireStagedPlan();
          const zone = { name: textValue(input.name, 'name', 80), sector: textValue(input.sector, 'sector', 80), population: numberValue(input.population, 'population', 0, 100000) };
          const nextPlan = { ...plan, evacuations: [...plan.evacuations, zone] };
          setStagedPlan(nextPlan);
          return { staged: true, evacuationZone: zone, planSummary: summarizePlan(nextPlan), orderIssued: false, liveSimulationChanged: false };
        },
      },
      {
        name: 'commit_plan', title: 'Submit the plan for approval',
        description: 'Opens the review and asks for a single human approval covering the whole plan.',
        inputSchema: schema({}), annotations: { readOnlyHint: false },
        execute: async (_input, options) => {
          if (!stateRef.current.stagedPlan) throw new Error('No draft plan is open. Call propose_plan and add the actions to review before commit_plan.');
          const approved = await new Promise<boolean>((resolve) => {
            const finish = (decision: boolean) => {
              options?.signal.removeEventListener('abort', cancel);
              resolve(decision);
            };
            const cancel = () => finish(false);
            if (options?.signal.aborted) {
              resolve(false);
              return;
            }
            reviewResolver.current = finish;
            options?.signal.addEventListener('abort', cancel, { once: true });
            setReviewOpen(true);
          });
          return { approved, planApplied: approved };
        },
      },
      {
        name: 'revert_plan', title: 'Revert the last plan', description: 'Undoes the last applied plan.',
        inputSchema: schema({}), annotations: mutating, execute: () => ({ reverted: revertPlan() }),
      },
      {
        name: 'run_simulation', title: 'Advance the simulation', description: 'Advances the local engine by 5 to 360 minutes.',
        inputSchema: schema({ minutes: { type: 'integer', minimum: 5, maximum: 360 } }, ['minutes']), annotations: mutating,
        execute: async (input) => {
          const delta = numberValue(input.minutes, 'minutes', 5, 360);
          const targetMinutes = stateRef.current.minutes + delta;
          const engine = await runWorker({
            type: 'simulate', ignitionLngLat: ignitionRef.current, extraIgnitions: extraIgnitionsRef.current, reset: true, targetMinutes, moisture: 0.08,
            windKph: stateRef.current.weather.windSpeed, windDirection: stateRef.current.weather.windDirection,
            temperature: stateRef.current.weather.temperature, humidity: stateRef.current.weather.humidity,
            droughtIndex: stateRef.current.weather.droughtIndex, windBearingDegrees: stateRef.current.weather.windBearing,
            domain: stateRef.current.domain, terrain: stateRef.current.terrain,
            startHour: stateRef.current.incident.startHour + stateRef.current.incident.startMinute / 60,
            slopeDegrees: 7.4, deployments: stateRef.current.committed, firebreaks: stateRef.current.committedFirebreaks, includeForecast: true,
          });
          applyEngineResult(engine);
          setMinutes(targetMinutes);
          return { advancedMinutes: delta, totalMinutes: targetMinutes, worker: 'local-browser', ...engineDigest(engine) };
        },
      },
      {
        name: 'set_time', title: 'Set the clock', description: 'Moves the scenario between H+0 and H+24.',
        inputSchema: schema({ minutesFromIgnition: { type: 'integer', minimum: 0, maximum: 1440 } }, ['minutesFromIgnition']), annotations: mutating,
        execute: async (input) => {
          const value = numberValue(input.minutesFromIgnition, 'minutesFromIgnition', 0, 1440);
          const engine = await runWorker({ type: 'simulate', ignitionLngLat: ignitionRef.current, extraIgnitions: extraIgnitionsRef.current, reset: true, targetMinutes: value, temperature: stateRef.current.weather.temperature, humidity: stateRef.current.weather.humidity, droughtIndex: stateRef.current.weather.droughtIndex, windKph: stateRef.current.weather.windSpeed, windDirection: stateRef.current.weather.windDirection, windBearingDegrees: stateRef.current.weather.windBearing, domain: stateRef.current.domain, terrain: stateRef.current.terrain, startHour: stateRef.current.incident.startHour + stateRef.current.incident.startMinute / 60, slopeDegrees: 7.4, deployments: stateRef.current.committed, firebreaks: stateRef.current.committedFirebreaks, includeForecast: true });
          applyEngineResult(engine); setMinutes(value); return { minutesFromIgnition: value, ...engineDigest(engine) };
        },
      },
      {
        name: 'set_weather', title: 'Change the weather',
        description: 'Changes the simulation weather. windDirection is where the wind blows FROM (North, North-east, East, South-east, South, South-west, West, North-west); the spread bearing is derived from it.',
        inputSchema: schema({
          windSpeed: { type: 'number', minimum: 0, maximum: 150 },
          windDirection: { type: 'string', enum: COMPASS.map((point) => point.from), maxLength: 40 },
          gusts: { type: 'number', minimum: 0, maximum: 200 },
          humidity: { type: 'number', minimum: 5, maximum: 95 },
          temperature: { type: 'number', minimum: -5, maximum: 48 },
        }, ['windSpeed','windDirection']), annotations: mutating,
        execute: (input) => {
          const windDirection = textValue(input.windDirection, 'windDirection', 40);
          const windBearing = bearingFromProvenance(windDirection);
          if (windBearing === null) throw new Error(`Unknown wind origin "${windDirection}". Accepted values: ${COMPASS.map((point) => point.from).join(', ')}.`);
          const current = stateRef.current.weather;
          const next = {
            ...current,
            windSpeed: numberValue(input.windSpeed, 'windSpeed', 0, 150),
            windDirection, windBearing,
            gusts: input.gusts === undefined ? current.gusts : numberValue(input.gusts, 'gusts', 0, 200),
            humidity: input.humidity === undefined ? current.humidity : numberValue(input.humidity, 'humidity', 5, 95),
            temperature: input.temperature === undefined ? current.temperature : numberValue(input.temperature, 'temperature', -5, 48),
          };
          weatherSeriesRef.current = null; setWeatherSeries(null); setWeatherSource('manual');
          setWeather(next); return next;
        },
      },
      {
        name: 'ignite', title: 'Place the exercise ignition',
        description: 'Moves the ignition point of the training scenario and restarts the simulation from there.',
        inputSchema: schema({ lng: { type: 'number', minimum: -180, maximum: 180 }, lat: { type: 'number', minimum: -90, maximum: 90 }, sector: { type: 'string', maxLength: 80 } }, ['lng','lat']), annotations: mutating,
        execute: async (input) => {
          const lng = numberValue(input.lng, 'lng', -180, 180);
          const lat = numberValue(input.lat, 'lat', -90, 90);
          const placed = { lng, lat, radiusM: 0 };
          setIgnition(placed);
          applyExtraIgnitions([]);
          ignitionRef.current = placed;
          const engine = await runWorker({
            type: 'simulate', ignitionLngLat: { lng, lat }, extraIgnitions: [], reset: true, targetMinutes: stateRef.current.minutes,
            temperature: stateRef.current.weather.temperature, humidity: stateRef.current.weather.humidity,
            droughtIndex: stateRef.current.weather.droughtIndex, windKph: stateRef.current.weather.windSpeed,
            windDirection: stateRef.current.weather.windDirection, windBearingDegrees: stateRef.current.weather.windBearing,
            domain: stateRef.current.domain, terrain: stateRef.current.terrain,
            startHour: stateRef.current.incident.startHour + stateRef.current.incident.startMinute / 60,
            slopeDegrees: 7.4, deployments: stateRef.current.committed, firebreaks: stateRef.current.committedFirebreaks, includeForecast: true,
          });
          applyEngineResult(engine);
          return { ignited: true, ignition: engine.ignition, simulationOnly: true };
        },
      },
      {
        name: 'compare_plans', title: 'Compare strategies',
        description: 'Simulates exactly 3 named strategies and returns a quantified comparison at T+1h, T+3h or T+6h.',
        inputSchema: schema({ planNames: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', maxLength: 80 } }, horizonHours: { type: 'integer', enum: [1,3,6] } }, ['planNames']), annotations: mutating,
        execute: async (input) => {
          if (!Array.isArray(input.planNames) || input.planNames.length !== 3) throw new Error('Field "planNames" must hold exactly 3 strategy names to compare.');
          const names = input.planNames.map((name) => textValue(name, 'planName', 80));
          return comparePlansWithWorker(names, Number(input.horizonHours || 6));
        },
      },
      {
        name: 'focus_region', title: 'Focus a region', description: 'Centres the map on one of the five available scenarios without changing the live simulation.',
        inputSchema: schema({ scenarioId: { type: 'string', enum: ['landiras','saumos','etoile','bug','blank'] } }, ['scenarioId']), annotations: mutating,
        execute: (input) => {
          const scenarioId = textValue(input.scenarioId, 'scenarioId', 20) as Scenario['preset'];
          const preset = scenarioPresets.find((item) => item.id === scenarioId);
          if (!preset) throw new Error(`Scenario "${scenarioId}" is unknown. Call list_scenarios and pass one of the ids it returns.`);
          mapRef.current?.flyTo({ center: [preset.domain.lng, preset.domain.lat], zoom: preset.domain.boxMetres > 35000 ? 10.1 : 11.2, duration: 1000 });
          return { focused: true, scenarioId: preset.id, name: preset.name, center: { lng: preset.domain.lng, lat: preset.domain.lat }, activeScenarioChanged: false };
        },
      },
      {
        name: 'set_view_mode', title: 'Change the map mode', description: 'Switches between 2D, 3D relief and globe.',
        inputSchema: schema({ mode: { type: 'string', enum: ['2D','3D','globe'] } }, ['mode']), annotations: mutating,
        execute: (input) => { const mode = textValue(input.mode, 'mode', 5) as ViewMode; if (!['2D','3D','globe'].includes(mode)) throw new Error(`Map mode "${mode}" is unknown. Use 2D, 3D or globe.`); changeView(mode); return { mode }; },
      },
    ];
    const definitionsWithJournal: ToolDefinition[] = defs.map((definition) => ({
      ...definition,
      execute: async (input, client) => {
        try {
          const result = await definition.execute(input, client);
          logTool(definition.name, toolActivityLabel(definition.name, result));
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          logTool(definition.name, `Failed: ${message}`, 'error');
          throw error;
        }
      },
    }));
    const teardown = new AbortController();
    void Promise.all(definitionsWithJournal.map((definition) => (
      mc.registerTool(definition, { signal: teardown.signal })
    ))).catch((error) => {
      console.error('Native WebMCP tool registration failed.', error);
    });
    return () => {
      // Aborting the registration signal retires every tool per the WebMCP specification.
      teardown.abort();
      reviewResolver.current?.(false);
      reviewResolver.current = null;
    };
  }, [applyEngineResult, applyExtraIgnitions, changeView, comparePlansWithWorker, logTool, makePlan, modelContextReady, revertPlan, runWorker]);

  const onMapDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('firenow/unit');
    if (!type) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const coordinate = mapRef.current?.unproject([event.clientX - rect.left, event.clientY - rect.top]);
    if (!coordinate) return;
    stageUnit({ type, count: 1, sector: 'Map point', mission: 'Task to be defined', lng: coordinate.lng, lat: coordinate.lat, radiusM: 700, capacity: unitSuppressionCapacity(type) });
    notify(type + ' added to the draft plan. No resource committed.');
  };
  const signOut = async () => {
    const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
    const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrfToken },
    });
    window.location.reload();
  };
  // The tutorial belongs to a new account, not to a first visit: login-client
  // leaves a flag behind when an operator registers, and the console spends it
  // once. Collapsed panels are unfolded before measuring, or the light would
  // land on an element of zero width.
  const openPanel = useCallback((panel: 'resources' | 'situation') => {
    if (isNarrowViewport) { setMobilePanel(panel); return; }
    if (panel === 'resources') setRailOpen(true); else setSituationOpen(true);
  }, [isNarrowViewport]);
  const tourSteps: TourStep[] = [
    {
      id: 'scenario', target: '[data-tour="scenario"]',
      title: 'Pick the simulation',
      body: 'Every simulation keeps its own ignition, weather and units. Landiras and Saumos replay fires from the Gironde, Étoile is an exercise, and the blank simulation starts from an empty map.',
    },
    {
      id: 'resources', target: '#resources-panel',
      title: 'Commit the fleet',
      body: 'Thirteen unit types, with manufacturer tank and pump figures. Click to stage a unit, or drag it onto the map. Nothing is committed until you approve the plan.',
      before: () => openPanel('resources'),
    },
    {
      id: 'situation', target: '#situation-panel',
      title: 'Read the fire',
      body: 'Area burned, head rate of spread, required flow against deployed flow, residents at risk. Open the weather card to turn the wind: the engine recomputes immediately.',
      before: () => openPanel('situation'),
    },
    {
      id: 'map', target: '[data-tour="map"]',
      title: 'Place the ignition, change the view',
      body: '"Ignition" adds a start point — hold and drag to widen it. 2D, 3D and globe change the projection without losing anything of the running simulation.',
    },
    {
      id: 'timeline', target: '[data-tour="timeline"]',
      title: 'Move the clock',
      body: 'The button runs or pauses the simulation. The slider moves it from H+0 to H+12, and the multiplier sets how fast simulated time passes.',
    },
  ];
  const finishTour = useCallback((completed: boolean) => {
    setTourOpen(false);
    if (completed) notify('Tutorial finished. You can replay it from the help menu.');
  }, [notify]);
  useEffect(() => {
    let pending = false;
    try {
      pending = window.localStorage.getItem(TOUR_PENDING_KEY) === '1';
      // Spent on sight: a reload during the tour should not replay it, and the
      // operator can always restart it from the help menu.
      if (pending) window.localStorage.removeItem(TOUR_PENDING_KEY);
    } catch { /* storage unavailable */ }
    if (!pending) return;
    const timer = window.setTimeout(() => setTourOpen(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  const activeName = scenarioList.find((item) => item.id === activeScenario)?.name || 'Simulation';
  const activeIsBlank = !ignition;
  const simState: 'active' | 'pause' | 'blank' = !ignition ? 'blank' : running ? 'active' : 'pause';
  const shownBurnedHa = ignition ? burnedHa : null;
  const shownFrontRate = ignition ? frontRate : null;
  const shownSuppression = ignition ? suppression : null;
  const STATUS_LABEL: Record<string, string> = { out: 'Fire out', controlled: 'Controlled', contained: 'Contained', spreading: 'Spreading freely' };
  const ATTACK_LABEL: Record<string, string> = { direct: 'Direct attack viable', 'heavy-units': 'Heavy units required', indirect: 'Direct attack ineffective' };
  const committedCount = committed.reduce((sum, item) => sum + item.count, 0);
  const stagedCount = stagedPlan?.deployments.reduce((sum, item) => sum + item.count, 0) || 0;
  const stagedUnitSummary = Object.entries((stagedPlan?.deployments || []).reduce<Record<string, number>>((summary, unit) => {
    summary[unit.type] = (summary[unit.type] || 0) + unit.count;
    return summary;
  }, {})).map(([type, count]) => `${count} ${type}`).join(' · ');
  const noActionResult = stagedPlan?.comparison?.find((strategy) => strategy.resources === 0);
  const selectedPlanResult = stagedPlan?.comparison?.find((strategy) => strategy.resources > 0);
  const avoidedHa = noActionResult && selectedPlanResult ? Math.max(0, noActionResult.burnedHa - selectedPlanResult.burnedHa) : null;
  const selectedImpactWidth = noActionResult && selectedPlanResult && noActionResult.burnedHa > 0
    ? Math.max(4, Math.min(100, selectedPlanResult.burnedHa / noActionResult.burnedHa * 100))
    : 100;
  const timeLabel = 'H+' + String(Math.floor(minutes / 60)).padStart(2,'0') + ':' + String(minutes % 60).padStart(2,'0');
  // Incident clock: the scenario's real start time plus simulated time.
  const clockAt = (offset: number) => {
    const total = incident.startHour * 60 + incident.startMinute + offset;
    return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  };
  const incidentClock = incident.dateLabel + ' · ' + clockAt(minutes);
  const timelineMarks = [0, 120, 240, 360, 480, 600, 720].map((offset) => clockAt(offset));
  const timelinePosition = Math.min(minutes, TIMELINE_MAX_MINUTES);
  const timelineProgress = timelinePosition / TIMELINE_MAX_MINUTES * 100;

  return (
    <main className="ops-shell">
      <div className={'map-stage view-' + viewMode.toLowerCase() + (pickingIgnition ? ' picking' : '')} aria-label="Tactical fire map" onDragOver={(event) => event.preventDefault()} onDrop={onMapDrop}>
        <div ref={mapNode} className="maplibre-host" /><div className="map-shade" />
        {stagedPlan?.firebreaks.map((line) => <div key={line.name} className="ghost-firebreak"><span>{line.name} · {line.lengthKm} km</span></div>)}
        {stagedPlan?.evacuations.map((zone) => <div key={zone.name} className="ghost-evac"><span>PROPOSED ZONE · {zone.name}</span></div>)}
      </div>

      {!ignition && !pickingIgnition && <div className="blank-cta glass-panel">
        <span className="blank-icon"><Flame size={20} /></span>
        <strong>Blank map</strong>
        <p>No ignition placed. Pick a start point to run the simulation.</p>
        <button className="primary-button" type="button" onClick={() => setPickingIgnition(true)}><Flame size={14} />Place the ignition</button>
      </div>}

      {pickingIgnition && <div className="pick-hint glass-panel"><Flame size={13} /><span>Click to add an ignition — <b>hold and drag</b> to widen it · {ignition ? 1 + additionalIgnitions.length : 0} active{draftIgnition && draftIgnition.radiusM > 0 ? ' · radius ' + Math.round(draftIgnition.radiusM) + ' m' : ''}</span><button type="button" onClick={() => { setPickingIgnition(false); setDraftIgnition(null); }}>Cancel</button></div>}

      <header className="topbar glass-panel">
        <div className="brand-block"><span className="brand-mark"><img src="/brand/mark.png" width={1024} height={1024} alt="" aria-hidden="true" /></span><div><strong>FireNow</strong><span>Command console</span></div></div>
        <div className="scenario-picker" data-tour="scenario">
          <button className={'scenario-title' + (scenarioOpen ? ' open' : '')} type="button" onClick={() => setScenarioOpen((value) => !value)} aria-expanded={scenarioOpen}>
            <span>{activeIsBlank ? 'FREE SIMULATION' : incident.ref}</span>
            <strong>{activeName}<ChevronDown size={13} /></strong>
          </button>
          {scenarioOpen && <>
            <div className="popover-shield" role="presentation" onMouseDown={() => setScenarioOpen(false)} />
            <div className="popover scenario-pop glass-panel">
              <div className="popover-head"><span>SIMULATIONS</span><button type="button" onClick={() => { createScenario('blank'); setScenarioOpen(false); }}><Plus size={13} />New</button></div>
              <div className="preset-row">
                <span>REPLAYS</span>
                <div>
                  <button type="button" onClick={() => { createScenario('saumos'); setScenarioOpen(false); }} title="Gironde — Saumos fire, 22 July 2026">Gironde</button>
                  <button type="button" onClick={() => { createScenario('etoile'); setScenarioOpen(false); }} title="Provence — Étoile massif, mistral exercise">Marseille</button>
                  <button type="button" onClick={() => { createScenario('bug'); setScenarioOpen(false); }} title="California — Bug Fire, 8 August 2026">California</button>
                </div>
              </div>
              <div className="scenario-list">{scenarioList.map((item) => {
                const isActive = item.id === activeScenario;
                const state = !item.ignition ? 'blank' : (isActive && running) ? 'active' : 'pause';
                return <button key={item.id} type="button" className={'scenario-row' + (isActive ? ' current' : '')} onClick={() => { if (!isActive) switchScenario(item.id); setScenarioOpen(false); }}>
                  <span className={'sim-dot ' + state} />
                  <span className="scenario-meta"><strong>{item.name}</strong><small>{!item.ignition ? 'No ignition placed' : (item.burnedHa === null ? '—' : item.burnedHa.toLocaleString('en-US') + ' ha') + ' · H+' + String(Math.floor(item.minutes / 60)).padStart(2,'0') + ':' + String(item.minutes % 60).padStart(2,'0')}</small></span>
                  <span className={'sim-state ' + state}>{state === 'active' ? 'Running' : state === 'pause' ? 'Paused' : 'Blank'}</span>
                </button>;
              })}</div>
              <p className="popover-foot">Switching simulations pauses the previous one. Each keeps its own ignition, weather and units.</p>
            </div>
          </>}
        </div>
        <div className="top-actions">
          <span className={'status-chip ' + simState}><i />{simState === 'active' ? 'Simulation running' : simState === 'pause' ? 'Simulation paused' : 'No ignition'}</span>
          <div className="pop-anchor">
            <button className={'icon-button' + (helpOpen ? ' active' : '')} type="button" aria-label="Help" aria-expanded={helpOpen} onClick={() => setHelpOpen((value) => !value)}><CircleHelp size={17} /></button>
            {helpOpen && <>
              <div className="popover-shield" role="presentation" onMouseDown={() => setHelpOpen(false)} />
              <div className="popover help-pop glass-panel">
                <div className="popover-head"><span>HOW TO READ THIS SCREEN</span><button type="button" onClick={() => setHelpOpen(false)}><X size={13} /></button></div>
                <dl className="help-list">
                  <div><dt>Area burned</dt><dd>Total area the fire has run over since ignition, computed cell by cell on a 195 m grid.</dd></div>
                  <div><dt>Head rate of spread</dt><dd>Front speed along the wind axis, from the Rothermel (1972) model. Flanks and rear advance far more slowly.</dd></div>
                  <div><dt>Simulated time</dt><dd>Minutes elapsed since ignition. The timeline at the bottom drives this counter.</dd></div>
                  <div><dt>Solid / dashed outline</dt><dd>The solid line is the current situation. The dashed one is the T+3 h projection if nothing changes.</dd></div>
                  <div><dt>Calibration</dt><dd>Not performed for this scenario. The published deviations against real fires are large: treat the figures as a training order of magnitude, not a forecast.</dd></div>
                </dl>
                <button className="help-tour-button" type="button" onClick={() => { setHelpOpen(false); setTourOpen(true); }}><Command size={13} />Replay the tutorial</button>
              </div>
            </>}
          </div>
          <div className="pop-anchor">
            <button className={'avatar-button' + (accountOpen ? ' active' : '')} type="button" aria-expanded={accountOpen} onClick={() => setAccountOpen((value) => !value)} title={userEmail}>{userEmail.slice(0,2).toUpperCase()}</button>
            {accountOpen && <>
              <div className="popover-shield" role="presentation" onMouseDown={() => setAccountOpen(false)} />
              <div className="popover account-pop glass-panel">
                <div className="account-head"><span className="account-avatar">{userEmail.slice(0,2).toUpperCase()}</span><div><strong>{userEmail}</strong><small>Operator session</small></div></div>
                <dl className="account-facts">
                  <div><dt>Simulations</dt><dd>{scenarioList.length}</dd></div>
                  <div><dt>Units committed</dt><dd>{committedCount}</dd></div>
                </dl>
                <p className="account-note"><ShieldCheck size={12} />The WebMCP agent acts inside this session. No key is ever exposed.</p>
                <button className="account-signout" type="button" onClick={signOut}><LogOut size={13} />Sign out</button>
              </div>
            </>}
          </div>
        </div>
      </header>

      <AgentBridge initialCall={initialCall} />

      <aside id="resources-panel" className={'left-rail glass-panel' + ((isNarrowViewport ? mobilePanel === 'resources' : railOpen) ? '' : ' collapsed') + (mobilePanel === 'resources' ? ' mobile-open' : '')}>
        <div className="panel-heading">
          <div><span>RESOURCES</span><strong>Available units</strong></div>
          <span className="resource-count">{FLEET_TOTAL}</span>
          <button className="panel-toggle" type="button" aria-expanded={isNarrowViewport ? mobilePanel === 'resources' : railOpen}
            aria-label={(isNarrowViewport ? mobilePanel === 'resources' : railOpen) ? 'Collapse the units panel' : 'Expand the units panel'}
            onClick={() => isNarrowViewport ? setMobilePanel((current) => current === 'resources' ? null : 'resources') : setRailOpen((value) => !value)}><ChevronUp size={13} /></button>
        </div>
        <div className="panel-scroll" tabIndex={0} role="region" aria-label="Available units and sustainable duty at commitment" onKeyDown={scrollPanelByKeyboard}>
          <p className="drag-hint">Drag a unit onto a road, or click to stage it</p>
          <div className="autonomy-control">
            <label htmlFor="autonomy">SUSTAINABLE DUTY AT COMMITMENT</label>
            <input id="autonomy" type="range" min={20} max={100} step={5} value={autonomy}
              onChange={(event) => setAutonomy(Number(event.target.value))} />
            <b>{autonomy} %</b>
          </div>
          <p className="autonomy-note">A unit at {autonomy}% holds only {autonomy}% of its theoretical flow: fuel, crew relief and the water supply chain.</p>
          {FAMILIES.map((family) => <div className="unit-group" key={family}>
            <span className="unit-group-head">{FAMILY_LABEL[family]}</span>
            <div className="unit-list">{units.filter((unit) => unit.family === family).map((unit) => {
              const UnitIcon = UNIT_ICONS[unit.code] || Truck;
              const capacityLevel = unitCapacityLevel(unit);
              return <button className="unit-card" type="button" draggable onDragStart={(event) => event.dataTransfer.setData('firenow/unit', unit.code)} onClick={() => { stageUnit({ type: unit.code, count: 1, sector: 'Anchor point', mission: 'Task to be defined', lng: domain.lng, lat: domain.lat, radiusM: 900, capacity: unitSuppressionCapacity(unit.code), autonomy }); notify(unit.code + ' added. No resource committed.'); }} aria-label={`Stage ${unit.label} (${unit.code}), ${unit.tank}`} key={unit.code}>
                <span className={'unit-visual fam-' + unitFamilyClass(unit.family)}><UnitIcon size={18} strokeWidth={1.8} aria-hidden="true" /><span className="capacity-gauge" aria-hidden="true">{[1, 2, 3].map((level) => <i className={level <= capacityLevel ? 'filled' : ''} key={level} />)}</span></span>
                <span className="unit-copy"><strong>{unit.label}</strong><small><code>{unit.code}</code> · {unit.tank} · duty {autonomy}%</small></span>
                <b>{String(unit.count).padStart(2,'0')}</b>
              </button>;
            })}</div>
          </div>)}
        </div>
        <div className="rail-footer panel-foot"><span><i />{committedCount} committed</span><span>{FLEET_TOTAL - committedCount} available</span></div>
      </aside>

      <aside id="situation-panel" className={'situation-panel glass-panel' + ((isNarrowViewport ? mobilePanel === 'situation' : situationOpen) ? '' : ' collapsed') + (mobilePanel === 'situation' ? ' mobile-open' : '')}>
        <div className="panel-heading">
          <div><span>{incidentClock}</span><strong>Operational situation</strong></div>
          <span className="beta-chip">BETA</span>
          <button className="panel-toggle" type="button" aria-expanded={isNarrowViewport ? mobilePanel === 'situation' : situationOpen}
            aria-label={(isNarrowViewport ? mobilePanel === 'situation' : situationOpen) ? 'Collapse the situation panel' : 'Expand the situation panel'}
            onClick={() => isNarrowViewport ? setMobilePanel((current) => current === 'situation' ? null : 'situation') : setSituationOpen((value) => !value)}><ChevronUp size={13} /></button>
        </div>
        <div className="panel-scroll" tabIndex={0} role="region" aria-label="Situation: weather, fuel cover, exposure and suppression" onKeyDown={scrollPanelByKeyboard}>
        <div className="metric-grid"><div><span>Area burned</span><strong>{shownBurnedHa === null ? '—' : shownBurnedHa.toLocaleString('en-US')} <small>ha</small></strong><em>worker computed</em></div><div><span>Head rate</span><strong>{shownFrontRate === null ? '—' : shownFrontRate.toLocaleString('en-US')} <small>m/min</small></strong><em>Rothermel model</em></div><div><span>Simulated time</span><strong>{minutes} <small>min</small></strong><em>since ignition</em></div><div><span>Calibration</span><strong>—</strong><em>not performed</em></div></div>
        <button className={'weather-card' + (weatherOpen ? ' open' : '')} type="button" onClick={() => setWeatherOpen((value) => !value)} aria-expanded={weatherOpen}>
          <span className="weather-icon"><Wind size={18} /></span>
          <span className="weather-main"><span>WIND FROM {weather.windDirection.toUpperCase()}</span><strong>{weather.windSpeed} <small>km/h</small></strong></span>
          <span className="gust"><span>GUSTS</span><strong>{weather.gusts}</strong></span>
          <span className="weather-caret"><ChevronDown size={14} /></span>
        </button>
        <div className="weather-details"><span><small>TEMP.</small><b>{weather.temperature} °C</b></span><span><small>HUMIDITY</small><b>{weather.humidity} %</b></span><span><small>DROUGHT</small><b>{weather.droughtIndex.toFixed(2)}</b></span></div>
        {weatherOpen && <div className="weather-editor">
          <div className="wind-row">
            <div className="wind-dial" role="group" aria-label="Wind direction">
              <div className="dial-face">
                <i className="dial-needle" style={{ transform: 'rotate(' + weather.windBearing + 'deg)' }} />
                <span className="dial-n">N</span><span className="dial-e">E</span><span className="dial-s">S</span><span className="dial-w">W</span>
              </div>
              <small>{COMPASS[Math.round(weather.windBearing / 45) % 8].label}</small>
            </div>
            <div className="wind-buttons">{COMPASS.map((point) => <button key={point.label} type="button" className={Math.round(weather.windBearing / 45) % 8 === point.index ? 'active' : ''} onClick={() => patchWeather({ windBearing: point.bearing, windDirection: point.from })} title={'Wind from ' + point.from}>{point.short}</button>)}</div>
          </div>
          <Slider label="Wind speed" value={weather.windSpeed} min={0} max={120} unit="km/h" onChange={(windSpeed) => patchWeather({ windSpeed, gusts: Math.max(weather.gusts, Math.round(windSpeed * 1.4)) })} />
          <Slider label="Gusts" value={weather.gusts} min={0} max={160} unit="km/h" onChange={(gusts) => patchWeather({ gusts })} />
          <Slider label="Relative humidity" value={weather.humidity} min={5} max={95} unit="%" onChange={(humidity) => patchWeather({ humidity })} />
          <Slider label="Temperature" value={weather.temperature} min={-5} max={48} unit="°C" onChange={(temperature) => patchWeather({ temperature })} />
          <Slider label="Drought index" value={Math.round(weather.droughtIndex * 100)} min={0} max={100} unit="%" onChange={(value) => patchWeather({ droughtIndex: value / 100 })} />
          <div className="weather-presets">
            <span>PRESETS</span>
            <div>{WEATHER_PRESETS.map((preset) => <button key={preset.label} type="button" onClick={() => { weatherSeriesRef.current = null; setWeatherSeries(null); setWeatherSource('manual'); setWeather((current) => ({ ...current, ...preset.values })); }}>{preset.label}</button>)}</div>
          </div>
          <p className={'weather-note weather-source ' + weatherSource}>{weatherSource === 'open-meteo' ? <><b>Real hourly series active.</b> Wind, temperature and humidity follow the <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noreferrer">Open‑Meteo</a> archive. Changing any setting switches back to manual.</> : weatherSource === 'loading' ? 'Loading the hourly weather series…' : weatherSource === 'error' ? 'Archive unavailable · manual settings kept.' : 'Manual weather · settings stay constant outside the diurnal cycle.'}</p>
        </div>}
        {composition.length > 0 && <div className="cover-card">
          <span className="cover-head">DOMINANT COVER · {(REGION_LABEL[(terrain?.region) || 'gironde'])}</span>
          {composition.map((entry) => <div className="cover-row" key={entry.name}>
            <i style={{ width: Math.max(4, entry.share * 100) + '%' }} />
            <span>{entry.name}</span><b>{(entry.share * 100).toFixed(0)} %</b>
          </div>)}
          {terrain?.region === 'gironde' && <small className={'data-source-status ' + landscapeStatus}>{landscapeStatus === 'real' ? 'IGN BD Forêt / BD TOPO · INSEE 200 m grid · 90 m DEM' : landscapeStatus === 'loading' ? 'Loading territorial data…' : 'Real data unavailable · procedural fallback'}</small>}
        </div>}
        {exposure && <div className="exposure-card">
          <span className="cover-head">EXPOSURE · {exposure.residentsAtRisk > 0 ? 'RESIDENTS AT RISK' : 'NO POPULATION EXPOSED'}</span>
          <div className="exposure-grid">
            <div><span>Residents at risk</span><b className={exposure.residentsAtRisk > 0 ? 'danger' : ''}>{exposure.residentsAtRisk.toLocaleString('en-US')}</b></div>
            <div><span>Residents reached</span><b className={exposure.residentsReached > 0 ? 'danger' : ''}>{exposure.residentsReached.toLocaleString('en-US')}</b></div>
            <div><span>Built area burned</span><b>{exposure.builtAreaBurnedHa.toLocaleString('en-US')} <small>ha</small></b></div>
            <div><span>Routes cut</span><b>{(exposure.tracksCutKm + exposure.roadsCutKm).toLocaleString('en-US')} <small>km</small></b></div>
          </div>
          <small>Of which {exposure.roadsCutKm.toLocaleString('en-US')} km are public roads — the rest is the DFCI forest track network.</small>
        </div>}
        {shownSuppression && <div className={'suppression-card ' + shownSuppression.status}>
          <div className="supp-head">
            <span className={'supp-dot ' + shownSuppression.status} />
            <strong>{STATUS_LABEL[shownSuppression.status]}</strong>
            <span className={'supp-mode ' + shownSuppression.attackMode}>{ATTACK_LABEL[shownSuppression.attackMode]}</span>
          </div>
          <div className="supp-gauge" aria-label="Water coverage">
            <i style={{ width: Math.min(100, shownSuppression.containmentRatio * 100) + '%' }} />
          </div>
          <div className="supp-grid">
            <div><span>Deployed flow</span><b className="water">{shownSuppression.deployedFlowLpm.toLocaleString('en-US')} <small>L/min</small></b></div>
            <div><span>Required flow</span><b>{shownSuppression.requiredFlowLpm.toLocaleString('en-US')} <small>L/min</small></b></div>
            <div><span>Active perimeter</span><b>{shownSuppression.activePerimeterM.toLocaleString('en-US')} <small>m</small></b></div>
            <div><span>Head intensity</span><b className={shownSuppression.attackViable ? '' : 'danger'}>{shownSuppression.firelineIntensityKwM.toLocaleString('en-US')} <small>kW/m</small></b></div>
          </div>
          <div className="front-split" aria-label="Front breakdown">
            <div className="front-bars">
              <i className="head" style={{ flexGrow: Math.max(1, shownSuppression.headM) }} title="Head" />
              <i className="flank" style={{ flexGrow: Math.max(1, shownSuppression.flankM) }} title="Flanks" />
              <i className="rear" style={{ flexGrow: Math.max(1, shownSuppression.rearM) }} title="Rear" />
            </div>
            <div className="front-legend">
              <span><i className="head" />Head {shownSuppression.headM.toLocaleString('en-US')} m</span>
              <span><i className="flank" />Flanks {shownSuppression.flankM.toLocaleString('en-US')} m</span>
              <span><i className="rear" />Rear {shownSuppression.rearM.toLocaleString('en-US')} m</span>
            </div>
            <small>Perimeter mean: {shownSuppression.meanIntensityKwM.toLocaleString('en-US')} kW/m — the rear backs into the wind and needs little water.</small>
          </div>
          <p className="supp-verdict">
            {shownSuppression.status === 'out' ? 'The front is no longer advancing.'
              : shownSuppression.containmentMinutes !== null
                ? <>Containment estimated in <b>{shownSuppression.containmentMinutes} min</b> · {shownSuppression.litresPerHour.toLocaleString('en-US')} L consumed per hour</>
                : shownSuppression.attackViable
                  ? <><b>{Math.max(0, shownSuppression.requiredFlowLpm - shownSuppression.deployedFlowLpm).toLocaleString('en-US')} L/min</b> short of holding the front</>
                  : <>Above 4,000 kW/m no flow is enough: control line or indirect attack</>}
          </p>
        </div>}
        </div>
        <p className="model-disclaimer panel-foot">Rothermel 1972 model · training tool · not calibrated against historical fires</p>
      </aside>

      <nav className="panel-tabs glass-panel" aria-label="Map panels">
        <button type="button" className={mobilePanel === 'resources' ? 'active' : ''} aria-controls="resources-panel" aria-expanded={mobilePanel === 'resources'} onClick={() => setMobilePanel((current) => current === 'resources' ? null : 'resources')}>Units</button>
        <button type="button" className={mobilePanel === 'situation' ? 'active' : ''} aria-controls="situation-panel" aria-expanded={mobilePanel === 'situation'} onClick={() => setMobilePanel((current) => current === 'situation' ? null : 'situation')}>Situation</button>
      </nav>

      {stagedPlan && <section className="proposal-bar glass-panel"><span className="proposal-icon"><Command size={16} /></span><div><small>DRAFT PLAN · NOTHING COMMITTED</small><strong>{stagedPlan.name}</strong></div><span className="proposal-summary">{stagedCount} units · {stagedPlan.firebreaks.length} line · {stagedPlan.evacuations.length} zone</span><button className="danger-button" type="button" onClick={() => { setStagedPlan(null); notify('Draft plan discarded. No resource was ever committed.'); }}>Discard</button><button className="secondary-button" type="button" onClick={() => setComparisonOpen(true)}>Compare</button><button className="primary-button" type="button" onClick={() => setReviewOpen(true)}>Apply</button></section>}
      {activities.length > 0 && <button className="activity-pill glass-panel" type="button" onClick={() => setAgentOpen(true)}><Bot size={14} />{activities.length} WebMCP call{activities.length > 1 ? 's' : ''}<ChevronDown size={13} /></button>}

      <aside className="map-legend glass-panel" aria-label="Map legend">
        <span><i className="lg-scar" />Area burned</span>
        <span><i className="lg-active" />Active flame front</span>
        <span><i className="lg-forecast" />Projected position at +3 h</span>
      </aside>
      <nav className="map-controls glass-panel" data-tour="map" aria-label="Map: ignition and projection"><button className={pickingIgnition ? 'active' : ''} onClick={() => setPickingIgnition((value) => !value)} title="Add an ignition"><Flame size={13} />Ignition</button><button onClick={() => { setIgnition(null); ignitionRef.current = null; applyExtraIgnitions([]); setMinutes(0); setCommitted([]); setCommittedFirebreaks([]); setStagedPlan(null); setUndoStack([]); setRunning(false); setPickingIgnition(true); notify('Simulation cleared.'); }} title="Clear this simulation"><RotateCcw size={13} />Clear</button><button className={viewMode === '2D' ? 'active' : ''} onClick={() => changeView('2D')}><MapIcon size={13} />2D</button><button className={viewMode === '3D' ? 'active' : ''} onClick={() => changeView('3D')}><Layers3 size={13} />3D</button><button className={viewMode === 'globe' ? 'active' : ''} onClick={() => changeView('globe')}><Globe2 size={13} />Globe</button></nav>
      <section className="timeline glass-panel" data-tour="timeline">
        <div className="time-readout"><span>INCIDENT CLOCK</span><strong>{clockAt(minutes)}</strong><small>{timeLabel} since ignition</small></div>
        <button className="play-button" type="button" onClick={() => setRunning((value) => !value)} aria-label={running ? 'Pause the simulation' : 'Run the simulation'}>{running ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
        <div className="timeline-track">
          <div className="timeline-scrubber-head"><span>TIMELINE · PAUSES WHILE YOU SCRUB</span><output htmlFor="incident-timeline">{timeLabel}</output></div>
          <div className="timeline-scrubber-row">
            <button type="button" onClick={() => seekTimeline(timelinePosition - 15)} aria-label="Back 15 minutes">−15</button>
            <label className="sr-only" htmlFor="incident-timeline">Simulation time, from zero to twelve hours</label>
            <input id="incident-timeline" className="timeline-scrubber" type="range" min="0" max={TIMELINE_MAX_MINUTES} step="5" value={timelinePosition} onChange={(event) => seekTimeline(Number(event.target.value))} style={{ background: `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${timelineProgress}%, rgba(255,255,255,.14) ${timelineProgress}%, rgba(255,255,255,.14) 100%)` }} />
            <button type="button" onClick={() => seekTimeline(timelinePosition + 15)} aria-label="Forward 15 minutes">+15</button>
          </div>
          <div className="time-labels">{timelineMarks.map((mark) => <span key={mark}>{mark}</span>)}</div>
        </div>
        <div className="speed-control"><span>SPEED</span><button type="button" onClick={() => setSpeed((value) => value === 20 ? 50 : value === 50 ? 1 : 20)} aria-label={`Simulation speed is currently ${speed} times real time. Change the speed.`}>× {speed}</button></div>
      </section>

      {comparisonOpen && <Modal labelledBy="comparison-title" onClose={() => setComparisonOpen(false)}><section className="compare-modal glass-panel"><ModalHead titleId="comparison-title" icon={<Layers3 size={18} />} eyebrow="3 WORKER RUNS · T+6H" title="Strategy comparison" onClose={() => setComparisonOpen(false)} /><div className="compare-grid">{(stagedPlan?.comparison || []).map((strategy,index) => <article key={strategy.name} className={index === 0 ? 'recommended' : ''} aria-label={index === 0 ? 'Recommended strategy' : undefined}><header><div><small>{index === 0 ? 'SMALLEST AREA' : strategy.resources === 0 ? 'BASELINE' : 'ALTERNATIVE'}</small><strong>{strategy.name}</strong></div>{index === 0 && <span><Check size={12} />Computed result</span>}</header><p>{strategy.description}</p><dl><div><dt>Area burned</dt><dd>{strategy.burnedHa.toLocaleString('en-US')} ha</dd></div><div><dt>Head rate</dt><dd>{strategy.rateOfSpread.toLocaleString('en-US')} m/min</dd></div><div><dt>Units</dt><dd>{strategy.resources}</dd></div></dl></article>)}</div><div className="compare-footer"><span>Model not calibrated · results computed locally</span><button className="primary-button" type="button" onClick={() => { setComparisonOpen(false); setReviewOpen(true); }}>Take the smallest result</button></div></section></Modal>}

      {reviewOpen && stagedPlan && <Modal labelledBy="review-title" onClose={rejectPlan}><section className="review-panel glass-panel"><ModalHead titleId="review-title" icon={<Command size={18} />} title={stagedCount > 0 ? `Commit ${stagedCount} units?` : 'Commit this plan?'} onClose={rejectPlan} /><p className="review-intention">&ldquo;{stagedPlan.intention}&rdquo;</p>{noActionResult && selectedPlanResult && <div className="decision-impact" aria-label="Area burned at six hours, compared"><div className="decision-row"><span>No action</span><i><b style={{ width: '100%' }} /></i><strong>{noActionResult.burnedHa.toLocaleString('en-US')} ha</strong></div><div className="decision-row selected"><span>With this plan</span><i><b style={{ width: selectedImpactWidth + '%' }} /></i><strong>{selectedPlanResult.burnedHa.toLocaleString('en-US')} ha</strong></div>{avoidedHa !== null && <p>− {avoidedHa.toLocaleString('en-US')} ha at T+6 h</p>}</div>}<div className="plan-contents"><p>{stagedUnitSummary || 'No additional units'}</p>{stagedPlan.firebreaks.length > 0 && <p>{stagedPlan.firebreaks.length} control line{stagedPlan.firebreaks.length > 1 ? 's' : ''} · {stagedPlan.firebreaks.reduce((sum, line) => sum + line.lengthKm, 0).toLocaleString('en-US')} km</p>}{stagedPlan.evacuations.length > 0 && <p>{stagedPlan.evacuations.length} zone{stagedPlan.evacuations.length > 1 ? 's' : ''} · {stagedPlan.evacuations.reduce((sum, zone) => sum + zone.population, 0).toLocaleString('en-US')} people · no order transmitted</p>}</div><p className="review-warning"><ShieldCheck size={13} />Model not calibrated · training tool</p><div className="review-actions"><button className="secondary-button" type="button" onClick={rejectPlan}>Reject</button><button className="primary-button commit-button" type="button" onClick={applyPlan}><Check size={15} />{stagedCount > 0 ? `Commit ${stagedCount} units` : 'Commit this plan'}</button></div></section></Modal>}

      {agentOpen && <aside className="agent-drawer glass-panel" aria-label="WebMCP call log"><ModalHead icon={<Bot size={18} />} eyebrow="AGENT CALLS" title="WebMCP log" onClose={() => setAgentOpen(false)} /><div className="agent-guidance"><span>TRY ASKING YOUR AGENT</span><ol><li>&ldquo;Analyse the situation and give me two strategies to protect Landiras East.&rdquo;</li><li>&ldquo;The wind shifts to north-west at 40 km/h. Recompute and adapt the plan.&rdquo;</li><li>&ldquo;Compare the plan with and without air units, then submit the better one.&rdquo;</li></ol></div><div className="activity-list">{activities.length === 0 && <p className="empty-activity">Real WebMCP calls appear here, with the tool and its result. Open FireNow with an agent, then ask for something.</p>}{activities.map((activity) => <div key={activity.id}><span className={activity.state}><i>{activity.state === 'done' ? <Check size={11} /> : <X size={11} />}</i></span><div><code>{activity.tool}</code><p>{activity.label}</p></div><time>{activity.at}</time></div>)}</div></aside>}
      {undoStack.length > 0 && <button className="undo-banner glass-panel" type="button" onClick={revertPlan}><Undo2 size={14} />Plan applied · Undo</button>}
      {tourOpen && <Tour steps={tourSteps} onFinish={finishTour} />}
      {toast && <div className="toast glass-panel" role="status"><Check size={15} />{toast}</div>}
    </main>
  );
}

function Slider({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void }) {
  return (
    <label className="slider-row">
      <span className="slider-head">{label}<b>{value} {unit}</b></span>
      <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
function Modal({ children, labelledBy, onClose }: { children: React.ReactNode; labelledBy: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return <div ref={dialogRef} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} onMouseDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}>{children}</div>;
}
function ModalHead({ icon, eyebrow, title, titleId, onClose }: { icon: React.ReactNode; eyebrow?: string; title: string; titleId?: string; onClose: () => void }) {
  return <div className="drawer-heading"><div><span className="drawer-icon" aria-hidden="true">{icon}</span><div>{eyebrow && <small>{eyebrow}</small>}<h2 id={titleId}>{title}</h2></div></div><button type="button" aria-label="Fermer" onClick={onClose}><X size={18} /></button></div>;
}
