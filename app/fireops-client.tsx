'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl';
import {
  Bot, Check, ChevronDown, CircleHelp, Command, Flame, Globe2, Layers3,
  LogOut, Map as MapIcon, Pause, Play, Plus, RotateCcw, ShieldCheck, Sparkles,
  TimerReset, Undo2, Wind, X, ChevronUp,
} from 'lucide-react';

type ViewMode = '2D' | '3D' | 'globe';
type Weather = { windSpeed: number; windDirection: string; windBearing: number; gusts: number; temperature: number; humidity: number; droughtIndex: number; plumeDriven?: boolean };
type Domain = { lng: number; lat: number; boxMetres: number };
type Exposure = {
  populationAtteinte: number; populationMenacee: number;
  surfaceBatieHa: number; pistesCoupeesKm: number; routesCoupeesKm: number;
};
type Region = 'gironde' | 'marseille' | 'california-basin' | 'california-chaparral' | 'california-sierra';
type Terrain = { region?: Region; oceanWestOfLng?: number; water?: { lng: number; lat: number; radiusM: number }[]; urban?: { lng: number; lat: number; radiusM: number }[] };
type Deployment = { id: string; type: string; count: number; autonomy?: number; sector: string; mission: string; lng: number; lat: number; radiusM: number; capacity: number; staged?: boolean };
type StrategyResult = { name: string; burnedHa: number; rateOfSpread: number; resources: number; description: string; deployments: Deployment[] };
type Plan = {
  id: string; name: string; intention: string; deployments: Deployment[];
  tasks: { unitId: string; mission: string }[];
  firebreaks: { name: string; sector: string; lengthKm: number }[];
  evacuations: { name: string; sector: string; population: number }[];
  movedFrom?: string[];
  comparison?: StrategyResult[];
};
type Activity = { id: string; tool: string; label: string; state: 'running' | 'done'; at: string };
type Ignition = { lng: number; lat: number; radiusM: number };
type Suppression = {
  firelineIntensityKwM: number; meanIntensityKwM: number; activePerimeterM: number;
  headM: number; flankM: number; rearM: number; requiredFlowLpm: number;
  deployedFlowLpm: number; containmentRatio: number; containmentMinutes: number | null;
  litresPerHour: number; attackViable: boolean; status: 'eteint' | 'maitrise' | 'contenu' | 'libre';
  attackMode: 'directe' | 'moyens-lourds' | 'indirect'; appliances: number; lineMetresPerHour: number;
};
type Scenario = {
  id: string; name: string; createdAt: number; preset: 'landiras' | 'saumos' | 'etoile' | 'bug' | 'blank';
  ignition: Ignition | null; minutes: number; weather: Weather; committed: Deployment[];
  domain: Domain; terrain?: Terrain; incident: Incident; burnedHa: number | null;
};
// L en-tete affichait la date de Landiras quel que soit le scenario ouvert.
type Incident = { ref: string; dateLabel: string; startHour: number; startMinute: number };
type ToolClient = { requestUserInteraction?: <T>(handler: () => Promise<T>) => Promise<T> };
type ToolDefinition = {
  name: string; title: string; description: string; inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>, client?: ToolClient) => unknown | Promise<unknown>;
};
type ModelContextLike = {
  registerTool: (tool: ToolDefinition) => Promise<void> | void;
  unregisterTool?: (name: string) => Promise<void> | void;
};

const initialWeather: Weather = {
  windSpeed: 22, windDirection: 'Nord-ouest', windBearing: 135, gusts: 38,
  temperature: 39, humidity: 19, droughtIndex: 0.95,
};
// Le parc reprend les caracteristiques constructeur portees par le moteur :
// cuve, debit de pompe et duree de remplissage donnent le debit soutenu.
const units = [
  { code: 'VLHR', count: 14, label: 'Véhicules légers hors route', famille: 'terrestre', cuve: '600 L' },
  { code: 'CCF',  count: 18, label: 'Camions-citernes feux de forêts', famille: 'terrestre', cuve: '4 000 L' },
  { code: 'CCFS', count: 6,  label: 'Camions-citernes super', famille: 'terrestre', cuve: '8 000 L' },
  { code: 'FPT',  count: 6,  label: 'Fourgons pompe-tonne', famille: 'terrestre', cuve: '3 000 L' },
  { code: 'CCGC', count: 4,  label: 'Citernes grande capacité', famille: 'terrestre', cuve: '13 000 L' },
  { code: 'HBE',  count: 2,  label: 'Hélicoptères bombardiers d’eau', famille: 'aérien', cuve: '1 000 L' },
  { code: 'HELIT', count: 1, label: 'Hélicoptère lourd S-64', famille: 'aérien', cuve: '9 500 L' },
  { code: 'AT8',  count: 4,  label: 'Air Tractor AT-802F', famille: 'aérien', cuve: '3 100 L' },
  { code: 'CL4',  count: 4,  label: 'Canadair CL-415', famille: 'aérien', cuve: '6 137 L' },
  { code: 'DASH', count: 2,  label: 'Dash-8 Q400MR', famille: 'aérien', cuve: '10 000 L' },
  { code: 'A400', count: 1,  label: 'A400M (retardant)', famille: 'aérien', cuve: '20 000 L' },
  { code: 'DOZ',  count: 3,  label: 'Bulldozers', famille: 'génie', cuve: '320 m/h' },
  { code: 'CREW', count: 8,  label: 'Équipes au sol (20 sapeurs)', famille: 'génie', cuve: '90 m/h' },
];
const REGION_LABEL: Record<string, string> = {
  gironde: 'Landes de Gascogne',
  marseille: 'Provence calcaire',
  'california-basin': 'Grand Bassin · steppe à armoise',
  'california-chaparral': 'Chaparral cismontain',
  'california-sierra': 'Sierra Nevada · forêt montagnarde',
};
const FAMILLES: string[] = ['terrestre', 'aérien', 'génie'];
const PARC_TOTAL = units.reduce((sum, unit) => sum + unit.count, 0);
const planDescriptions = [
  'Concentration des moyens sur le flanc nord et la lisière du village.',
  'Répartition mobile sur les deux flancs avec une réserve centrale.',
  'Projection de référence sans nouveau moyen engagé.',
];
const defaultIgnition: Ignition = { lng: -0.4540519, lat: 44.5897472, radiusM: 0 };
const landirasUnits = (): Deployment[] => [
  { id: 'ccf22', type: 'CCF', count: 22, sector: 'Flanc nord-est', mission: 'Tenue du flanc gauche', lng: -0.4159, lat: 44.6088, radiusM: 2200, capacity: 0.09 },
  { id: 'ccf18', type: 'CCF', count: 18, sector: 'Flanc sud-ouest', mission: 'Tenue du flanc droit', lng: -0.4922, lat: 44.5707, radiusM: 2200, capacity: 0.09 },
  { id: 'fpt08', type: 'FPT', count: 8, sector: 'Sud-est', mission: 'Défense des habitations', lng: -0.4139, lat: 44.5611, radiusM: 1600, capacity: 0.06 },
  { id: 'cl404', type: 'CL4', count: 4, sector: 'Tête', mission: 'Largages sur la tête de feu', lng: -0.4272, lat: 44.5707, radiusM: 2600, capacity: 0.08 },
  { id: 'hbe02', type: 'HBE', count: 2, sector: 'Flanc nord-est', mission: 'Appui héliporté', lng: -0.4362, lat: 44.6025, radiusM: 1800, capacity: 0.08 },
  { id: 'doz04', type: 'DOZ', count: 4, sector: 'Sud-est', mission: 'Ligne d’appui DFCI', lng: -0.4050, lat: 44.5548, radiusM: 2000, capacity: 0.05 },
];
const LANDIRAS_DOMAIN: Domain = { lng: -0.4540519, lat: 44.5897472, boxMetres: 25000 };
// Saumos (44,921 N / -0,987 O). Le feu part vers le sud-ouest puis l'ouest :
// il faut une emprise de 50 km pour contenir les 47 000 ha parcourus.
const SAUMOS_IGNITION: Ignition = { lng: -0.987, lat: 44.921, radiusM: 0 };
const SAUMOS_DOMAIN: Domain = { lng: -1.10, lat: 44.80, boxMetres: 50000 };
// Sans le trait de cote ni les plans d'eau, la simulation propage le feu sur
// l'Atlantique et toute comparaison avec l'evenement reel perd son sens.
const SAUMOS_TERRAIN: Terrain = {
  region: 'gironde',
  oceanWestOfLng: -1.205,
  water: [
    { lng: -1.135, lat: 44.990, radiusM: 3200 },  // étang de Lacanau
    { lng: -1.130, lat: 44.680, radiusM: 7000 },  // bassin d’Arcachon
  ],
  urban: [
    { lng: -1.078, lat: 44.980, radiusM: 1500 },  // Lacanau
    { lng: -1.091, lat: 44.874, radiusM: 1300 },  // Le Porge
    { lng: -0.987, lat: 44.921, radiusM: 700 },   // Saumos
  ],
};
// Massif de l'Etoile, au nord-est de Marseille. Mistral de nord-ouest,
// garrigue et pin d'Alep : le contraste avec les Landes est maximal.
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
  windSpeed: 55, windDirection: 'Nord-ouest', windBearing: 135, gusts: 82,
  temperature: 34, humidity: 24, droughtIndex: 0.88,
});
const etoileUnits = (): Deployment[] => [
  { id: 'eccf1', type: 'CCF', count: 20, sector: 'Lisière urbaine', mission: 'Défense des habitations', lng: 5.4130, lat: 43.3050, radiusM: 2400, capacity: 0.09, autonomy: 90 },
  { id: 'ecl41', type: 'CL4', count: 4, sector: 'Tête', mission: 'Largages sur la tête', lng: 5.4900, lat: 43.2960, radiusM: 3000, capacity: 0.08, autonomy: 80 },
  { id: 'ehbe1', type: 'HBE', count: 3, sector: 'Flanc est', mission: 'Appui héliporté', lng: 5.4980, lat: 43.3300, radiusM: 2200, capacity: 0.08, autonomy: 75 },
  { id: 'ecrw1', type: 'CREW', count: 6, sector: 'Crêtes', mission: 'Ligne d’appui sur crête', lng: 5.4600, lat: 43.3400, radiusM: 2000, capacity: 0.05, autonomy: 85 },
];

// Bug Fire : Long Valley, comte de Lassen. Sagebrush, herbe et pinyon-genevrier,
// vent d'ouest soutenu (Washoe Zephyr), moyens tres legers.
const BUG_IGNITION: Ignition = { lng: -120.0366, lat: 39.7229, radiusM: 0 };
const BUG_DOMAIN: Domain = { lng: -119.90, lat: 39.72, boxMetres: 50000 };
const BUG_TERRAIN: Terrain = { region: 'california-basin' };
const bugWeather = (): Weather => ({
  windSpeed: 28, windDirection: 'Ouest', windBearing: 95, gusts: 56,
  temperature: 38, humidity: 12, droughtIndex: 0.92,
});
const bugUnits = (): Deployment[] => [
  { id: 'bccf1', type: 'CCF', count: 12, sector: 'Flanc sud', mission: 'Tenue du flanc', lng: -120.0366, lat: 39.6870, radiusM: 4000, capacity: 0.09, autonomy: 70 },
  { id: 'bdoz1', type: 'DOZ', count: 4, sector: 'Est', mission: 'Ligne d’appui', lng: -119.9700, lat: 39.7420, radiusM: 4000, capacity: 0.05, autonomy: 70 },
  { id: 'bhbe1', type: 'HBE', count: 2, sector: 'Tête', mission: 'Appui héliporté', lng: -119.9800, lat: 39.7229, radiusM: 4000, capacity: 0.08, autonomy: 60 },
];
const saumosWeather = (): Weather => ({
  windSpeed: 26, windDirection: 'Nord-est', windBearing: 225, gusts: 42,
  temperature: 38, humidity: 22, droughtIndex: 0.96,
});
// 3 300 pompiers, 18 moyens aeriens, 121 km de pare-feux, 105 vehicules forestiers.
const saumosUnits = (): Deployment[] => [
  { id: 'sccf1', type: 'CCF', count: 45, sector: 'Flanc sud', mission: 'Tenue du flanc sud', lng: -0.9870, lat: 44.8671, radiusM: 5000, capacity: 0.09 },
  { id: 'sccf2', type: 'CCF', count: 45, sector: 'Flanc sud-est', mission: 'Tenue du flanc est', lng: -0.9330, lat: 44.8828, radiusM: 5000, capacity: 0.09 },
  { id: 'sccf3', type: 'CCF', count: 40, sector: 'Le Porge', mission: 'Défense des habitations', lng: -1.0678, lat: 44.8639, radiusM: 5000, capacity: 0.09 },
  { id: 'sfpt1', type: 'FPT', count: 30, sector: 'Littoral', mission: 'Protection du littoral', lng: -1.1298, lat: 44.8841, radiusM: 4500, capacity: 0.06 },
  { id: 'scl41', type: 'CL4', count: 9, sector: 'Tête', mission: 'Largages sur la tête', lng: -1.0872, lat: 44.9085, radiusM: 6000, capacity: 0.08 },
  { id: 'shbe1', type: 'HBE', count: 9, sector: 'Flanc sud', mission: 'Appui héliporté', lng: -1.0170, lat: 44.8618, radiusM: 5000, capacity: 0.08 },
  { id: 'sdoz1', type: 'DOZ', count: 30, sector: 'Ouest', mission: 'Pare-feu (121 km réalisés)', lng: -1.1521, lat: 44.9210, radiusM: 5500, capacity: 0.05 },
];
const blankWeather = (): Weather => ({ windSpeed: 12, windDirection: 'Ouest', windBearing: 90, gusts: 18, temperature: 24, humidity: 45, droughtIndex: 0.40 });
const LANDIRAS_INCIDENT: Incident = { ref: 'INCIDENT 33-2022-0712', dateLabel: '12 JUIL. 2022', startHour: 14, startMinute: 0 };
const ETOILE_INCIDENT: Incident = { ref: 'EXERCICE 13-ETOILE', dateLabel: 'EXERCICE', startHour: 13, startMinute: 0 };
const BUG_INCIDENT: Incident = { ref: 'INCIDENT CA-LNU-2026-0808', dateLabel: '8 AOÛT 2026', startHour: 13, startMinute: 0 };
const SAUMOS_INCIDENT: Incident = { ref: 'INCIDENT 33-2026-0722', dateLabel: '22 JUIL. 2026', startHour: 13, startMinute: 30 };
const BLANK_INCIDENT: Incident = { ref: 'SIMULATION LIBRE', dateLabel: 'T0', startHour: 12, startMinute: 0 };
const makeScenario = (name: string, preset: 'landiras' | 'saumos' | 'etoile' | 'bug' | 'blank'): Scenario => {
  const base = { id: nextId(), name, createdAt: Date.now(), preset, burnedHa: null };
  if (preset === 'landiras') return { ...base, ignition: { ...defaultIgnition }, minutes: 162, weather: { ...initialWeather }, committed: landirasUnits(), domain: LANDIRAS_DOMAIN, terrain: { region: 'gironde' }, incident: LANDIRAS_INCIDENT };
  if (preset === 'etoile') return { ...base, ignition: { ...ETOILE_IGNITION }, minutes: 240, weather: etoileWeather(), committed: etoileUnits(), domain: ETOILE_DOMAIN, terrain: ETOILE_TERRAIN, incident: ETOILE_INCIDENT };
  if (preset === 'bug') return { ...base, ignition: { ...BUG_IGNITION }, minutes: 480, weather: bugWeather(), committed: bugUnits(), domain: BUG_DOMAIN, terrain: BUG_TERRAIN, incident: BUG_INCIDENT };
  if (preset === 'saumos') return { ...base, ignition: { ...SAUMOS_IGNITION }, minutes: 450, weather: saumosWeather(), committed: saumosUnits(), domain: SAUMOS_DOMAIN, terrain: SAUMOS_TERRAIN, incident: SAUMOS_INCIDENT };
  return { ...base, ignition: null, minutes: 0, weather: blankWeather(), committed: [], domain: LANDIRAS_DOMAIN, terrain: { region: 'gironde' }, incident: BLANK_INCIDENT };
};
const emptyGeoJSON = { type: 'FeatureCollection', features: [] } as const;
const toolNames = [
  'get_situation', 'list_units', 'get_fire_forecast', 'get_weather', 'query_terrain', 'list_scenarios',
  'propose_plan', 'stage_deploy_units', 'stage_assign_task', 'stage_firebreak', 'stage_evacuation_zone',
  'commit_plan', 'revert_plan', 'run_simulation', 'set_time', 'set_weather', 'ignite', 'compare_plans',
  'focus_region', 'set_view_mode',
];

// bearing = cap vers lequel le feu se propage ; `from` = provenance du vent, affichee a l'operateur.
const COMPASS = [
  { index: 0, short: 'N',  label: 'Vers le nord',      from: 'Sud',        bearing: 0 },
  { index: 1, short: 'NE', label: 'Vers le nord-est',  from: 'Sud-ouest',  bearing: 45 },
  { index: 2, short: 'E',  label: 'Vers l’est',        from: 'Ouest',      bearing: 90 },
  { index: 3, short: 'SE', label: 'Vers le sud-est',   from: 'Nord-ouest', bearing: 135 },
  { index: 4, short: 'S',  label: 'Vers le sud',       from: 'Nord',       bearing: 180 },
  { index: 5, short: 'SO', label: 'Vers le sud-ouest', from: 'Nord-est',   bearing: 225 },
  { index: 6, short: 'O',  label: 'Vers l’ouest',      from: 'Est',        bearing: 270 },
  { index: 7, short: 'NO', label: 'Vers le nord-ouest', from: 'Sud-est',   bearing: 315 },
];
const WEATHER_PRESETS: { label: string; values: Partial<Weather> }[] = [
  { label: 'Calme', values: { windSpeed: 8, gusts: 14, humidity: 55, temperature: 24, droughtIndex: 0.35 } },
  { label: 'Chaud et sec', values: { windSpeed: 22, gusts: 34, humidity: 22, temperature: 36, droughtIndex: 0.82 } },
  { label: 'Bascule NO 40 km/h', values: { windSpeed: 40, gusts: 62, windBearing: 135, windDirection: 'Nord-ouest', humidity: 18, temperature: 38, droughtIndex: 0.91 } },
  { label: 'Rafales 70 km/h', values: { windSpeed: 55, gusts: 70, humidity: 15, temperature: 39, droughtIndex: 0.95 } },
  { label: 'Panache orageux', values: { windSpeed: 38, gusts: 60, humidity: 18, temperature: 38, droughtIndex: 0.97, plumeDriven: true } },
];
const nextId = () => Math.random().toString(36).slice(2, 9);
const atNow = () => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const textValue = (value: unknown, field: string, max = 240) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(field + ' invalide.');
  return value.trim();
};
const numberValue = (value: unknown, field: string, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(field + ' doit être compris entre ' + min + ' et ' + max + '.');
  return value;
};
const grayscaleColor = (value: string) => {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  const rgb = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  let red: number; let green: number; let blue: number; let alpha: number | undefined;
  if (hex) {
    const raw = hex[1].length === 3 ? hex[1].split('').map((digit) => digit + digit).join('') : hex[1];
    red = parseInt(raw.slice(0, 2), 16); green = parseInt(raw.slice(2, 4), 16); blue = parseInt(raw.slice(4, 6), 16);
    alpha = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : undefined;
  } else if (rgb) {
    red = Number(rgb[1]); green = Number(rgb[2]); blue = Number(rgb[3]); alpha = rgb[4] === undefined ? undefined : Number(rgb[4]);
  } else return value;
  const luminance = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
  return alpha === undefined ? `rgb(${luminance},${luminance},${luminance})` : `rgba(${luminance},${luminance},${luminance},${alpha})`;
};
const grayscalePaint = (value: unknown): unknown => Array.isArray(value) ? value.map(grayscalePaint) : typeof value === 'string' ? grayscaleColor(value) : value;
// getPaintProperty LEVE une exception quand la propriete n'existe pas pour ce type de couche
// (par ex. 'fill-color' sur une couche 'background') -- il ne renvoie pas undefined. Interroger
// les trois proprietes sur toutes les couches faisait donc echouer la toute premiere iteration,
// ce qui interrompait le handler 'load' avant l'ajout des couches de feu et du relief.
const COLOR_PROPERTY: Record<string, string> = {
  background: 'background-color', fill: 'fill-color', line: 'line-color',
  'fill-extrusion': 'fill-extrusion-color',
};
const neutralizeMapStyle = (map: MapLibreMap) => {
  for (const layer of map.getStyle().layers || []) {
    const property = COLOR_PROPERTY[layer.type];
    if (property) {
      try {
        const value = map.getPaintProperty(layer.id, property as 'fill-color');
        if (value !== undefined) map.setPaintProperty(layer.id, property as 'fill-color', grayscalePaint(value));
      } catch { /* couche sans couleur explicite : on la laisse telle quelle */ }
    }
    if (layer.type === 'raster') {
      try { map.setPaintProperty(layer.id, 'raster-saturation', -1); } catch { /* idem */ }
    }
  }
};
const emptyPlan = (name = 'Plan de l’agent', intention = 'Renforcer la protection du village sous vent tournant.'): Plan => ({
  id: nextId(), name, intention, deployments: [], tasks: [], firebreaks: [], evacuations: [],
});

const initialScenarios: Scenario[] = [makeScenario('Landiras · 12 juil. 2022', 'landiras')];

export default function FireOpsClient({ userEmail }: { userEmail: string }) {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const engineGeoRef = useRef<{ perimeter: unknown; active: unknown; forecast: unknown }>({ perimeter: emptyGeoJSON, active: emptyGeoJSON, forecast: emptyGeoJSON });
  const simulationWorker = useRef<Worker | null>(null);
  const reviewResolver = useRef<((approved: boolean) => void) | null>(null);
  const [toolStatus, setToolStatus] = useState<'registering' | 'available' | 'unavailable'>('registering');
  const [mapReady, setMapReady] = useState(false);
  const [ignition, setIgnition] = useState<Ignition | null>(defaultIgnition);
  const [pickingIgnition, setPickingIgnition] = useState(false);
  const [draftIgnition, setDraftIgnition] = useState<Ignition | null>(null);
  const ignitionRef = useRef<Ignition | null>(defaultIgnition);
  const pickingRef = useRef(false);
  useEffect(() => { pickingRef.current = pickingIgnition; }, [pickingIgnition]);
  useEffect(() => { ignitionRef.current = ignition; }, [ignition]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('2D');
  const [weather, setWeather] = useState(initialWeather);
  const [minutes, setMinutes] = useState(162);
  const [scenarios, setScenarios] = useState<Scenario[]>(initialScenarios);
  const [activeScenario, setActiveScenario] = useState<string>(() => initialScenarios[0].id);
  const [accountOpen, setAccountOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [burnedHa, setBurnedHa] = useState<number | null>(null);
  const [frontRate, setFrontRate] = useState<number | null>(null);
  const [suppression, setSuppression] = useState<Suppression | null>(null);
  const [perimeterGeoJSON, setPerimeterGeoJSON] = useState<unknown>(emptyGeoJSON);
  const [forecastGeoJSON, setForecastGeoJSON] = useState<unknown>(emptyGeoJSON);
  const [activeGeoJSON, setActiveGeoJSON] = useState<unknown>(emptyGeoJSON);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(20);
  const [stagedPlan, setStagedPlan] = useState<Plan | null>(null);
  const [committed, setCommitted] = useState<Deployment[]>(landirasUnits);
  // La simulation ouverte au demarrage ne passe pas par la bascule : sans cela
  // son domaine et sa geographie ne parvenaient jamais au moteur.
  const [domain, setDomain] = useState<Domain>(initialScenarios[0].domain);
  const [terrain, setTerrain] = useState<Terrain | undefined>(initialScenarios[0].terrain);
  const [incident, setIncident] = useState<Incident>(initialScenarios[0].incident);
  // Autonomie appliquee aux moyens prepositionnes : elle borne le debit
  // qu'ils peuvent reellement tenir dans la duree.
  const [autonomy, setAutonomy] = useState(85);
  const [railOpen, setRailOpen] = useState(true);
  const [situationOpen, setSituationOpen] = useState(true);
  const [exposure, setExposure] = useState<Exposure | null>(null);
  const [composition, setComposition] = useState<{ nom: string; strate: string; part: number }[]>([]);
  const [undoStack, setUndoStack] = useState<Deployment[][]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const stateRef = useRef({ weather, minutes, burnedHa, frontRate, stagedPlan, committed, viewMode, domain, terrain, incident });

  useEffect(() => {
    stateRef.current = { weather, minutes, burnedHa, frontRate, stagedPlan, committed, viewMode, domain, terrain, incident };
  }, [weather, minutes, burnedHa, frontRate, stagedPlan, committed, viewMode, domain, terrain, incident]);

  const patchWeather = useCallback((patch: Partial<Weather>) => {
    setWeather((current) => ({ ...current, ...patch }));
  }, []);
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }, []);
  const logTool = useCallback((tool: string, label: string, delay = 0) => {
    const entry: Activity = { id: nextId(), tool, label, state: delay ? 'running' : 'done', at: atNow() };
    setActivities((current) => [entry, ...current].slice(0, 14));
    if (delay) window.setTimeout(() => setActivities((current) => current.map((item) => item.id === entry.id ? { ...item, state: 'done' } : item)), delay);
  }, []);
  const makePlan = useCallback((name: string, intention: string) => {
    const plan = emptyPlan(name, intention);
    setStagedPlan(plan);
    logTool('propose_plan', 'Plan « ' + name + ' » ouvert');
    return plan;
  }, [logTool]);
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
    setUndoStack((stack) => [...stack, committed]);
    const moved = new Set(stagedPlan.movedFrom || []);
    setCommitted((current) => [
      ...current.filter((item) => !moved.has(item.id)),
      ...stagedPlan.deployments.map((item) => ({ ...item, staged: false })),
    ]);
    logTool('commit_plan', String(stagedPlan.deployments.reduce((sum, item) => sum + item.count, 0)) + ' moyens engagés');
    setStagedPlan(null);
    setReviewOpen(false);
    reviewResolver.current?.(true);
    reviewResolver.current = null;
    notify('Plan appliqué. Toutes les actions restent annulables.');
    return true;
  }, [committed, logTool, notify, stagedPlan]);
  const rejectPlan = useCallback(() => {
    setReviewOpen(false);
    reviewResolver.current?.(false);
    reviewResolver.current = null;
    notify('Plan rejeté. La situation active n’a pas été modifiée.');
  }, [notify]);
  const revertPlan = useCallback(() => {
    let reverted = false;
    setUndoStack((stack) => {
      const previous = stack.at(-1);
      if (!previous) return stack;
      setCommitted(previous);
      reverted = true;
      return stack.slice(0, -1);
    });
    logTool('revert_plan', 'Dernier plan annulé');
    notify('Dernier plan annulé.');
    return reverted;
  }, [logTool, notify]);

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
      const map = new maplibre.Map({
        container: mapNode.current,
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: [defaultIgnition.lng, defaultIgnition.lat], zoom: 11.2, attributionControl: false, cooperativeGestures: false,
      });
      map.once('load', () => {
        try { neutralizeMapStyle(map); } catch { /* le fond reste colore, le feu prime */ }
        if (!map.getSource('terrain-dem')) map.addSource('terrain-dem', {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          tileSize: 256, encoding: 'terrarium', maxzoom: 15,
        });
        // Trois couches distinctes, du plus ancien au plus vif : la surface deja
        // parcourue, la bande encore en flammes, puis la projection a +3 h.
        map.addSource('fire', { type: 'geojson', data: engineGeoRef.current.perimeter as Parameters<GeoJSONSource['setData']>[0] });
        map.addLayer({ id: 'fire-fill', type: 'fill', source: 'fire', paint: { 'fill-color': '#7A2E1E', 'fill-opacity': 0.42 } });
        map.addLayer({ id: 'fire-line', type: 'line', source: 'fire', paint: { 'line-color': '#FF6B45', 'line-width': 1.6, 'line-opacity': 0.9 } });
        map.addSource('fire-active', { type: 'geojson', data: engineGeoRef.current.active as Parameters<GeoJSONSource['setData']>[0] });
        map.addLayer({ id: 'fire-active-fill', type: 'fill', source: 'fire-active', paint: { 'fill-color': '#FF7A18', 'fill-opacity': 0.55 } });
        map.addLayer({ id: 'fire-active-line', type: 'line', source: 'fire-active', paint: { 'line-color': '#FFC53D', 'line-width': 2.2, 'line-opacity': 0.95, 'line-blur': 1.2 } });
        map.addSource('fire-forecast', { type: 'geojson', data: engineGeoRef.current.forecast as Parameters<GeoJSONSource['setData']>[0] });
        map.addLayer({ id: 'fire-forecast-line', type: 'line', source: 'fire-forecast', paint: { 'line-color': '#FF3B30', 'line-width': 1.8, 'line-opacity': 0.8, 'line-dasharray': [3, 2] } });
        setMapReady(true);
      });
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
        setIgnition(placed); ignitionRef.current = placed;
        setPickingIgnition(false);
      });
      mapRef.current = map;
    }).catch(() => undefined);
    return () => { cancelled = true; setMapReady(false); mapRef.current?.remove(); mapRef.current = null; };
  }, []);

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
        else reject(new Error(event.data.error || 'Erreur du moteur.'));
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({ ...payload, id: requestId });
    });
  }, []);

  const applyEngineResult = useCallback((engine: Record<string, unknown>) => {
    const perimeter = engine.perimeterGeoJSON || emptyGeoJSON;
    const forecast = engine.forecastPerimeterGeoJSON || emptyGeoJSON;
    const active = engine.activeFrontGeoJSON || emptyGeoJSON;
    engineGeoRef.current = { perimeter, active, forecast };
    setBurnedHa(Number(engine.totalBurnedHa));
    setFrontRate(Number(engine.rateOfSpreadMetersPerMinute));
    setSuppression((engine.suppression as Suppression) ?? null);
    setPerimeterGeoJSON(perimeter);
    setForecastGeoJSON(forecast);
    setActiveGeoJSON(active);
    setComposition(Array.isArray(engine.fuelComposition) ? engine.fuelComposition.slice(0, 4) : []);
    setExposure((engine.exposure as Exposure) || null);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const shown = draftIgnition ?? ignition;
    if (!shown) return;
    let marker: Marker | null = null;
    let cancelled = false;
    import('maplibre-gl').then((maplibre) => {
      if (cancelled || !mapRef.current) return;
      const node = document.createElement('div');
      node.className = 'ignition-marker';
      node.title = 'Point de départ du feu';
      if (shown.radiusM > 0) {
        const halo = document.createElement('i');
        const metresPerPixel = 40075016.686 * Math.cos(shown.lat * Math.PI / 180) / (256 * Math.pow(2, mapRef.current.getZoom()));
        const diameter = Math.max(13, (shown.radiusM * 2) / metresPerPixel);
        halo.style.width = diameter + 'px'; halo.style.height = diameter + 'px';
        node.appendChild(halo);
      }
      marker = new maplibre.Marker({ element: node }).setLngLat([shown.lng, shown.lat]).addTo(mapRef.current);
    }).catch(() => undefined);
    return () => { cancelled = true; marker?.remove(); };
  }, [ignition, draftIgnition, mapReady, viewMode]);

  useEffect(() => {
    const fireSource = mapRef.current?.getSource('fire') as GeoJSONSource | undefined;
    const forecastSource = mapRef.current?.getSource('fire-forecast') as GeoJSONSource | undefined;
    const activeSource = mapRef.current?.getSource('fire-active') as GeoJSONSource | undefined;
    fireSource?.setData((ignition ? perimeterGeoJSON : emptyGeoJSON) as Parameters<GeoJSONSource['setData']>[0]);
    forecastSource?.setData((ignition ? forecastGeoJSON : emptyGeoJSON) as Parameters<GeoJSONSource['setData']>[0]);
    activeSource?.setData((ignition ? activeGeoJSON : emptyGeoJSON) as Parameters<GeoJSONSource['setData']>[0]);
  }, [forecastGeoJSON, perimeterGeoJSON, activeGeoJSON, ignition]);

  useEffect(() => {
    // Carte vierge : on vide la ref (lue par le handler 'load') sans toucher a l'etat,
    // les valeurs affichees etant derivees plus bas.
    if (!ignition) { engineGeoRef.current = { perimeter: emptyGeoJSON, active: emptyGeoJSON, forecast: emptyGeoJSON }; return; }
    runWorker({
      type: 'simulate', ignitionLngLat: ignition, reset: true, targetMinutes: minutes,
      temperature: weather.temperature, humidity: weather.humidity, droughtIndex: weather.droughtIndex,
      plumeDriven: weather.plumeDriven === true, domain, terrain,
      windKph: weather.windSpeed, windDirection: weather.windDirection, windBearingDegrees: weather.windBearing,
      startHour: incident.startHour + incident.startMinute / 60,
      slopeDegrees: 7.4, deployments: committed, includeForecast: true,
    }).then(applyEngineResult).catch(() => undefined);
  }, [applyEngineResult, committed, minutes, runWorker, weather.windDirection, weather.windSpeed, weather.windBearing, weather.temperature, weather.humidity, weather.droughtIndex, weather.plumeDriven, domain, terrain, ignition, incident]);

  // Bascule de simulation : on fige la courante dans la liste, puis on charge la cible.
  const switchScenario = useCallback((id: string) => {
    setRunning(false);
    setScenarios((list) => list.map((item) => item.id === activeScenario
      ? { ...item, ignition, minutes, weather, committed, domain, terrain, burnedHa }
      : item));
    const target = scenarios.find((item) => item.id === id);
    if (!target) return;
    setActiveScenario(id);
    setIgnition(target.ignition); ignitionRef.current = target.ignition;
    setMinutes(target.minutes); setWeather(target.weather); setCommitted(target.committed);
    setDomain(target.domain); setTerrain(target.terrain); setIncident(target.incident);
    mapRef.current?.jumpTo({ center: [target.domain.lng, target.domain.lat], zoom: target.domain.boxMetres > 35000 ? 10.1 : 11.2 });
    setStagedPlan(null); setUndoStack([]); setPickingIgnition(false);
  }, [activeScenario, burnedHa, committed, domain, terrain, ignition, minutes, scenarios, weather]);

  const createScenario = useCallback((preset: 'blank' | 'saumos' | 'etoile' | 'bug' = 'blank') => {
    setRunning(false);
    const NAMES: Record<string, string> = {
      saumos: 'Saumos · 22 juil. 2026', etoile: 'Marseille · Massif de l’Étoile', bug: 'Bug Fire · 8 août 2026',
    };
    const created = preset === 'blank'
      ? makeScenario('Simulation ' + String(scenarios.length + 1), 'blank')
      : makeScenario(NAMES[preset], preset);
    setScenarios((list) => list.map((item) => item.id === activeScenario
      ? { ...item, ignition, minutes, weather, committed, domain, terrain, burnedHa }
      : item).concat(created));
    setActiveScenario(created.id);
    setIgnition(created.ignition); ignitionRef.current = created.ignition;
    setMinutes(created.minutes); setWeather(created.weather); setCommitted(created.committed);
    setDomain(created.domain); setTerrain(created.terrain); setIncident(created.incident);
    mapRef.current?.jumpTo({ center: [created.domain.lng, created.domain.lat], zoom: created.domain.boxMetres > 35000 ? 10.1 : 11.2 });
    setStagedPlan(null); setUndoStack([]); setPickingIgnition(preset === 'blank');
    const NOTES: Record<string, string> = {
      saumos: 'Feu de Saumos, 22 juillet 2026 — 47 004 ha parcourus, 220 000 évacués.',
      etoile: 'Massif de l’Étoile — exercice mistral, garrigue et pin d’Alep. Ce n’est pas un feu historique.',
      bug: 'Bug Fire, 8 août 2026 — sagebrush et pinyon-genévrier, 93 733 acres parcourus.',
      blank: 'Nouvelle simulation. Placez le point de départ du feu.',
    };
    notify(NOTES[preset]);
  }, [activeScenario, burnedHa, committed, domain, terrain, ignition, minutes, notify, scenarios.length, weather]);

  // La liste affichee derive de l'etat vivant pour la simulation ouverte.
  const scenarioList = scenarios.map((item) => item.id === activeScenario
    ? { ...item, ignition, minutes, weather, committed, burnedHa }
    : item);

  useEffect(() => {
    let cancelled = false;
    import('maplibre-gl').then((maplibre) => {
      if (cancelled || !mapRef.current) return;
      markersRef.current.forEach((marker) => marker.remove());
      const deployments = [...committed, ...(stagedPlan?.deployments || [])];
      markersRef.current = deployments.map((unit) => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'unit-marker' + (unit.staged ? ' ghost' : '');
        element.title = unit.type + ' × ' + unit.count + ' · ' + unit.mission;
        element.setAttribute('aria-label', element.title);
        element.innerHTML = '<b>' + unit.type + '</b><span>' + String(unit.count).padStart(2, '0') + '</span>';
        const marker = new maplibre.Marker({ element, draggable: true }).setLngLat([unit.lng, unit.lat]).addTo(mapRef.current!);
        marker.on('dragend', () => {
          const { lng, lat } = marker.getLngLat();
          // Deplacer un moyen deja engage passe par le plan provisoire : la regle
          // "une seule validation par lot" vaut aussi pour les gestes manuels.
          if (unit.staged) {
            setStagedPlan((plan) => plan
              ? { ...plan, deployments: plan.deployments.map((item) => item.id === unit.id ? { ...item, lng, lat } : item) }
              : plan);
          } else {
            setStagedPlan((plan) => {
              const base = plan || emptyPlan('Redéploiement manuel', 'Repositionner un moyen déjà engagé.');
              const already = base.deployments.some((item) => item.id === unit.id);
              return already
                ? { ...base, deployments: base.deployments.map((item) => item.id === unit.id ? { ...item, lng, lat } : item) }
                : { ...base, deployments: [...base.deployments, { ...unit, lng, lat, staged: true }], movedFrom: [...(base.movedFrom || []), unit.id] };
            });
            notify(unit.type + ' repositionné dans le plan provisoire. Validez pour engager.');
          }
        });
        return marker;
      });
    }).catch(() => undefined);
    return () => { cancelled = true; markersRef.current.forEach((marker) => marker.remove()); markersRef.current = []; };
  }, [committed, mapReady, notify, stagedPlan?.deployments]);

  const comparePlansWithWorker = useCallback(async (names: string[], horizonHours: number) => {
    if (names.length !== 3) throw new Error('compare_plans exige exactement trois stratégies.');
    const placementSets: Deployment[][] = [
      [{ id: nextId(), type: 'CCF', count: 12, sector: 'Sud-est', mission: 'Intercepter la tête du feu', lng: -0.446, lat: 44.5825, radiusM: 1200, capacity: 0.09, staged: true }, { id: nextId(), type: 'DOZ', count: 3, sector: 'Est', mission: 'Ligne d’appui', lng: -0.438, lat: 44.586, radiusM: 700, capacity: 0.07, staged: true }],
      [{ id: nextId(), type: 'CCF', count: 6, sector: 'Nord', mission: 'Tenir le flanc nord', lng: -0.4541, lat: 44.597, radiusM: 900, capacity: 0.09, staged: true }, { id: nextId(), type: 'CCF', count: 6, sector: 'Sud', mission: 'Tenir le flanc sud', lng: -0.449, lat: 44.584, radiusM: 900, capacity: 0.09, staged: true }],
      [],
    ];
    const engineRuns = await Promise.all(placementSets.map((deployments) => {
      return runWorker({
        type: 'simulate', ignitionLngLat: ignitionRef.current, independent: true, targetMinutes: horizonHours * 60,
        temperature: stateRef.current.weather.temperature, humidity: stateRef.current.weather.humidity,
        droughtIndex: stateRef.current.weather.droughtIndex, windBearingDegrees: stateRef.current.weather.windBearing,
        plumeDriven: stateRef.current.weather.plumeDriven === true, domain: stateRef.current.domain, terrain: stateRef.current.terrain,
        windKph: stateRef.current.weather.windSpeed, windDirection: stateRef.current.weather.windDirection,
        startHour: stateRef.current.incident.startHour + stateRef.current.incident.startMinute / 60,
        slopeDegrees: 7.4, deployments,
      });
    }));
    const results = names.map((name, index): StrategyResult => ({
      name, description: planDescriptions[index], deployments: placementSets[index],
      resources: placementSets[index].reduce((sum, deployment) => sum + deployment.count, 0),
      burnedHa: Number(engineRuns[index].totalBurnedHa),
      rateOfSpread: Number(engineRuns[index].rateOfSpreadMetersPerMinute),
    })).sort((a, b) => a.burnedHa - b.burnedHa);
    setStagedPlan((plan) => ({ ...(plan || emptyPlan(results[0].name, 'Protéger le village après bascule du vent.')), comparison: results }));
    setComparisonOpen(true);
    logTool('compare_plans', '3 stratégies calculées par le moteur', 800);
    return { horizonHours, strategies: results, recommended: results[0].name, model: 'Rothermel 1972 + Alexander 1985', workerCalls: engineRuns.length };
  }, [logTool, runWorker]);

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
    logTool('set_view_mode', 'Vue ' + mode + ' activée');
  }, [logTool]);

  useEffect(() => {
    const mc = (document as Document & { modelContext?: ModelContextLike }).modelContext
      || (navigator as Navigator & { modelContext?: ModelContextLike }).modelContext;
    if (!mc || typeof mc.registerTool !== 'function') {
      queueMicrotask(() => setToolStatus('unavailable'));
      return;
    }
    const registered: string[] = [];
    const readOnly = { readOnlyHint: true };
    const defs: ToolDefinition[] = [
      {
        name: 'get_situation', title: 'Lire la situation opérationnelle',
        description: 'Retourne un état JSON compact du feu, de la météo, des moyens et zones menacées. Utiliser avant toute recommandation.',
        inputSchema: schema({}), annotations: readOnly,
        execute: () => {
          const s = stateRef.current;
          logTool('get_situation', 'Situation opérationnelle lue');
          return { incident: 'Landiras 2022', minutesFromIgnition: s.minutes, burnedHa: s.burnedHa, rateOfSpreadMetersPerMinute: s.frontRate, weather: s.weather, engagedUnits: s.committed, threatenedZones: ['Landiras Est', 'Guillos Nord'], calibrationStatus: 'not_performed' };
        },
      },
      {
        name: 'list_units', title: 'Lister les moyens',
        description: 'Liste les moyens disponibles et engagés avec position, statut, capacité et autonomie.',
        inputSchema: schema({}), annotations: readOnly, execute: () => ({ available: units, engaged: stateRef.current.committed }),
      },
      {
        name: 'get_fire_forecast', title: 'Projeter le front',
        description: 'Projette le feu à T+1h, T+3h et T+6h sous la météo courante.',
        inputSchema: schema({}), annotations: readOnly,
        execute: async () => {
          const projections = await Promise.all([1, 3, 6].map(async (hours) => {
            const result = await runWorker({ type: 'simulate', ignitionLngLat: ignitionRef.current, independent: true, targetMinutes: hours * 60, temperature: stateRef.current.weather.temperature, humidity: stateRef.current.weather.humidity, droughtIndex: stateRef.current.weather.droughtIndex, windBearingDegrees: stateRef.current.weather.windBearing, plumeDriven: stateRef.current.weather.plumeDriven === true, domain: stateRef.current.domain, terrain: stateRef.current.terrain, windKph: stateRef.current.weather.windSpeed, windDirection: stateRef.current.weather.windDirection, startHour: stateRef.current.incident.startHour + stateRef.current.incident.startMinute / 60, slopeDegrees: 7.4, deployments: stateRef.current.committed });
            return { horizon: 'T+' + hours + 'h', burnedHa: result.totalBurnedHa, rateOfSpreadMetersPerMinute: result.rateOfSpreadMetersPerMinute, perimeterGeoJSON: result.perimeterGeoJSON };
          }));
          return { model: 'Rothermel 1972 + Alexander 1985', projections, calibrationStatus: 'not_performed' };
        },
      },
      {
        name: 'get_weather', title: 'Lire la météo', description: 'Retourne vent, rafales, température, hygrométrie et sécheresse.',
        inputSchema: schema({}), annotations: readOnly, execute: () => stateRef.current.weather,
      },
      {
        name: 'query_terrain', title: 'Interroger le terrain', description: 'Analyse pente, exposition, combustible et accès routiers d’un secteur.',
        inputSchema: schema({ sector: { type: 'string', maxLength: 80 } }, ['sector']), annotations: readOnly,
        execute: (input) => ({ sector: textValue(input.sector, 'sector', 80), slopePercent: 7.4, aspect: 'sud-est', fuel: 'Pin maritime · Scott & Burgan TU5', roadAccess: 'D115 et piste P-17', dataSource: 'scenario-mask' }),
      },
      {
        name: 'list_scenarios', title: 'Lister les scénarios', description: 'Liste les scénarios disponibles et leur statut de calibration.',
        inputSchema: schema({}), annotations: readOnly,
        execute: () => ({ scenarios: [{ id: 'landiras-2022', name: 'Landiras I · Gironde', status: 'ready', calibrationStatus: 'not_performed' }] }),
      },
      {
        name: 'propose_plan', title: 'Ouvrir un plan provisoire',
        description: 'Ouvre une couche de proposition fantôme. Ne modifie jamais la simulation active.',
        inputSchema: schema({ name: { type: 'string', maxLength: 80 }, intention: { type: 'string', maxLength: 300 } }, ['name', 'intention']),
        execute: (input) => ({ staged: true, plan: makePlan(textValue(input.name, 'name', 80), textValue(input.intention, 'intention', 300)) }),
      },
      {
        name: 'stage_deploy_units', title: 'Prépositionner des moyens',
        description: 'Place jusqu’à 50 moyens dans le plan provisoire. N’engage aucun moyen.',
        inputSchema: schema({ units: { type: 'array', minItems: 1, maxItems: 50, items: schema({
          type: { type: 'string', enum: ['CCF', 'FPT', 'HBE', 'DOZ'] }, count: { type: 'integer', minimum: 1, maximum: 50 },
          sector: { type: 'string', maxLength: 80 }, mission: { type: 'string', maxLength: 160 },
          lng: { type: 'number', minimum: -180, maximum: 180 }, lat: { type: 'number', minimum: -90, maximum: 90 },
          radiusM: { type: 'number', minimum: 100, maximum: 5000 }, capacity: { type: 'number', minimum: 0, maximum: 0.35 },
        }, ['type', 'count', 'sector', 'mission', 'lng', 'lat', 'radiusM', 'capacity']) } }, ['units']),
        execute: (input) => {
          if (!Array.isArray(input.units) || input.units.length < 1 || input.units.length > 50) throw new Error('units doit contenir 1 à 50 groupes.');
          const deployments = input.units.map((raw) => {
            if (!raw || typeof raw !== 'object') throw new Error('Chaque moyen doit être un objet.');
            const item = raw as Record<string, unknown>;
            const type = textValue(item.type, 'type', 3);
            if (!['CCF','FPT','HBE','DOZ'].includes(type)) throw new Error('Type de moyen inconnu.');
            return stageUnit({ type, count: numberValue(item.count, 'count', 1, 50), sector: textValue(item.sector, 'sector', 80), mission: textValue(item.mission, 'mission', 160), lng: numberValue(item.lng, 'lng', -180, 180), lat: numberValue(item.lat, 'lat', -90, 90), radiusM: numberValue(item.radiusM, 'radiusM', 100, 5000), capacity: numberValue(item.capacity, 'capacity', 0, 0.35) });
          });
          if (deployments.reduce((sum, item) => sum + item.count, 0) > 50) throw new Error('Un plan provisoire ne peut pas dépasser 50 moyens.');
          logTool('stage_deploy_units', String(deployments.reduce((sum, item) => sum + item.count, 0)) + ' moyens prépositionnés');
          return { staged: true, deployments, liveSimulationChanged: false };
        },
      },
      {
        name: 'stage_assign_task', title: 'Affecter une mission provisoire', description: 'Affecte une mission sans modifier la simulation active.',
        inputSchema: schema({ unitId: { type: 'string', maxLength: 80 }, mission: { type: 'string', maxLength: 180 } }, ['unitId', 'mission']),
        execute: (input) => {
          const task = { unitId: textValue(input.unitId, 'unitId', 80), mission: textValue(input.mission, 'mission', 180) };
          setStagedPlan((plan) => plan ? { ...plan, tasks: [...plan.tasks, task] } : plan);
          return { staged: true, task };
        },
      },
      {
        name: 'stage_firebreak', title: 'Tracer une ligne d’appui', description: 'Ajoute une coupure provisoire visible en fantôme.',
        inputSchema: schema({ name: { type: 'string', maxLength: 80 }, sector: { type: 'string', maxLength: 80 }, lengthKm: { type: 'number', minimum: .1, maximum: 40 } }, ['name','sector','lengthKm']),
        execute: (input) => {
          const line = { name: textValue(input.name, 'name', 80), sector: textValue(input.sector, 'sector', 80), lengthKm: numberValue(input.lengthKm, 'lengthKm', .1, 40) };
          setStagedPlan((plan) => plan ? { ...plan, firebreaks: [...plan.firebreaks, line] } : plan);
          return { staged: true, firebreak: line };
        },
      },
      {
        name: 'stage_evacuation_zone', title: 'Préparer une zone d’évacuation',
        description: 'Délimite une zone provisoire. Aucun ordre n’est transmis.',
        inputSchema: schema({ name: { type: 'string', maxLength: 80 }, sector: { type: 'string', maxLength: 80 }, population: { type: 'integer', minimum: 0, maximum: 100000 } }, ['name','sector','population']),
        execute: (input) => {
          const zone = { name: textValue(input.name, 'name', 80), sector: textValue(input.sector, 'sector', 80), population: numberValue(input.population, 'population', 0, 100000) };
          setStagedPlan((plan) => plan ? { ...plan, evacuations: [...plan.evacuations, zone] } : plan);
          return { staged: true, evacuationZone: zone, orderIssued: false };
        },
      },
      {
        name: 'commit_plan', title: 'Soumettre le plan à validation',
        description: 'Ouvre la revue et demande une unique validation humaine pour tout le plan.',
        inputSchema: schema({}), annotations: { readOnlyHint: false },
        execute: async (_input, client) => {
          if (!stateRef.current.stagedPlan) throw new Error('Aucun plan provisoire.');
          const interaction = async () => new Promise<boolean>((resolve) => {
            reviewResolver.current = resolve;
            setReviewOpen(true);
          });
          const approved = client?.requestUserInteraction ? await client.requestUserInteraction(interaction) : await interaction();
          return { approved, planApplied: approved };
        },
      },
      {
        name: 'revert_plan', title: 'Annuler le dernier plan', description: 'Annule le dernier plan appliqué.',
        inputSchema: schema({}), execute: () => ({ reverted: revertPlan() }),
      },
      {
        name: 'run_simulation', title: 'Avancer la simulation', description: 'Avance le moteur local de 5 à 360 minutes.',
        inputSchema: schema({ minutes: { type: 'integer', minimum: 5, maximum: 360 } }, ['minutes']),
        execute: async (input) => {
          const delta = numberValue(input.minutes, 'minutes', 5, 360);
          const targetMinutes = stateRef.current.minutes + delta;
          const engine = await runWorker({
            type: 'simulate', ignitionLngLat: ignitionRef.current, reset: true, targetMinutes, moisture: 0.08,
            windKph: stateRef.current.weather.windSpeed, windDirection: stateRef.current.weather.windDirection,
            temperature: stateRef.current.weather.temperature, humidity: stateRef.current.weather.humidity,
            droughtIndex: stateRef.current.weather.droughtIndex, windBearingDegrees: stateRef.current.weather.windBearing,
            domain: stateRef.current.domain, terrain: stateRef.current.terrain,
            startHour: stateRef.current.incident.startHour + stateRef.current.incident.startMinute / 60,
            slopeDegrees: 7.4, deployments: stateRef.current.committed, includeForecast: true,
          });
          applyEngineResult(engine);
          setMinutes(targetMinutes);
          return { advancedMinutes: delta, totalMinutes: targetMinutes, burnedHa: engine.totalBurnedHa, worker: 'local-browser', engine };
        },
      },
      {
        name: 'set_time', title: 'Positionner l’heure', description: 'Positionne le scénario entre H+0 et H+24.',
        inputSchema: schema({ minutesFromIgnition: { type: 'integer', minimum: 0, maximum: 1440 } }, ['minutesFromIgnition']),
        execute: async (input) => {
          const value = numberValue(input.minutesFromIgnition, 'minutesFromIgnition', 0, 1440);
          const engine = await runWorker({ type: 'simulate', ignitionLngLat: ignitionRef.current, reset: true, targetMinutes: value, temperature: stateRef.current.weather.temperature, humidity: stateRef.current.weather.humidity, droughtIndex: stateRef.current.weather.droughtIndex, windKph: stateRef.current.weather.windSpeed, windDirection: stateRef.current.weather.windDirection, windBearingDegrees: stateRef.current.weather.windBearing, domain: stateRef.current.domain, terrain: stateRef.current.terrain, startHour: stateRef.current.incident.startHour + stateRef.current.incident.startMinute / 60, slopeDegrees: 7.4, deployments: stateRef.current.committed, includeForecast: true });
          applyEngineResult(engine); setMinutes(value); return { minutesFromIgnition: value, engine };
        },
      },
      {
        name: 'set_weather', title: 'Modifier la météo', description: 'Modifie les paramètres météo de la simulation.',
        inputSchema: schema({ windSpeed: { type: 'number', minimum: 0, maximum: 150 }, windDirection: { type: 'string', maxLength: 40 }, gusts: { type: 'number', minimum: 0, maximum: 200 } }, ['windSpeed','windDirection']),
        execute: (input) => {
          const next = { ...stateRef.current.weather, windSpeed: numberValue(input.windSpeed, 'windSpeed', 0, 150), windDirection: textValue(input.windDirection, 'windDirection', 40), gusts: input.gusts === undefined ? stateRef.current.weather.gusts : numberValue(input.gusts, 'gusts', 0, 200) };
          setWeather(next); logTool('set_weather', 'Vent ' + next.windDirection + ' · ' + next.windSpeed + ' km/h'); return next;
        },
      },
      {
        name: 'ignite', title: 'Placer le foyer d’exercice',
        description: 'Deplace le point d’allumage du scenario d’entrainement et relance la simulation depuis ce point.',
        inputSchema: schema({ lng: { type: 'number', minimum: -180, maximum: 180 }, lat: { type: 'number', minimum: -90, maximum: 90 }, sector: { type: 'string', maxLength: 80 } }, ['lng','lat']),
        execute: async (input) => {
          const lng = numberValue(input.lng, 'lng', -180, 180);
          const lat = numberValue(input.lat, 'lat', -90, 90);
          setIgnition({ lng, lat });
          ignitionRef.current = { lng, lat };
          const engine = await runWorker({
            type: 'simulate', ignitionLngLat: { lng, lat }, reset: true, targetMinutes: stateRef.current.minutes,
            temperature: stateRef.current.weather.temperature, humidity: stateRef.current.weather.humidity,
            droughtIndex: stateRef.current.weather.droughtIndex, windKph: stateRef.current.weather.windSpeed,
            windDirection: stateRef.current.weather.windDirection, windBearingDegrees: stateRef.current.weather.windBearing,
            domain: stateRef.current.domain, terrain: stateRef.current.terrain,
            startHour: stateRef.current.incident.startHour + stateRef.current.incident.startMinute / 60,
            slopeDegrees: 7.4, deployments: stateRef.current.committed, includeForecast: true,
          });
          applyEngineResult(engine);
          logTool('ignite', 'Foyer place');
          return { ignited: true, ignition: engine.ignition, simulationOnly: true };
        },
      },
      {
        name: 'compare_plans', title: 'Comparer des stratégies',
        description: 'Simule 2 ou 3 stratégies et retourne un comparatif chiffré à T+6h.',
        inputSchema: schema({ planNames: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', maxLength: 80 } }, horizonHours: { type: 'integer', enum: [1,3,6] } }, ['planNames']),
        execute: async (input) => {
          if (!Array.isArray(input.planNames) || input.planNames.length !== 3) throw new Error('Comparer exactement 3 plans.');
          const names = input.planNames.map((name) => textValue(name, 'planName', 80));
          return comparePlansWithWorker(names, Number(input.horizonHours || 6));
        },
      },
      {
        name: 'focus_region', title: 'Centrer une région', description: 'Centre la carte sur le scénario Landiras.',
        inputSchema: schema({ region: { type: 'string', enum: ['landiras'] } }, ['region']),
        execute: (input) => { const region = textValue(input.region, 'region', 20); mapRef.current?.flyTo({ center: [(ignitionRef.current ?? defaultIgnition).lng, (ignitionRef.current ?? defaultIgnition).lat], zoom: 11.2, duration: 1000 }); return { focused: region }; },
      },
      {
        name: 'set_view_mode', title: 'Changer le mode de carte', description: 'Bascule entre 2D, relief 3D et globe.',
        inputSchema: schema({ mode: { type: 'string', enum: ['2D','3D','globe'] } }, ['mode']),
        execute: (input) => { const mode = textValue(input.mode, 'mode', 5) as ViewMode; if (!['2D','3D','globe'].includes(mode)) throw new Error('Mode inconnu.'); changeView(mode); return { mode }; },
      },
    ];
    Promise.all(defs.map(async (definition) => { await mc.registerTool(definition); registered.push(definition.name); }))
      .then(() => setToolStatus('available')).catch(() => setToolStatus('unavailable'));
    return () => {
      registered.forEach((name) => { try { void mc.unregisterTool?.(name); } catch { /* teardown */ } });
      reviewResolver.current?.(false);
      reviewResolver.current = null;
    };
  }, [applyEngineResult, changeView, comparePlansWithWorker, logTool, makePlan, revertPlan, runWorker, stageUnit]);

  const runAgentDemo = useCallback(async () => {
    setAgentOpen(true);
    logTool('get_situation', 'Analyse du front et des zones menacées', 500);
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    setWeather((current) => ({ ...current, windDirection: 'Nord-ouest', windSpeed: 40, gusts: 58 }));
    logTool('set_weather', 'Vent nord-ouest · 40 km/h', 450);
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    const plan = makePlan('Bouclier village', 'Bloquer le flanc nord, renforcer le secteur B et protéger Landiras Est avant la bascule du vent.');
    const deployments: Deployment[] = [
      { id: nextId(), type: 'CCF', count: 12, sector: 'B', mission: 'Tenir la lisière est', lng: -0.446, lat: 44.5825, radiusM: 1200, capacity: 0.09, staged: true },
      { id: nextId(), type: 'DOZ', count: 3, sector: 'Nord', mission: 'Créer la ligne d’appui', lng: -0.449, lat: 44.596, radiusM: 700, capacity: 0.07, staged: true },
      { id: nextId(), type: 'FPT', count: 6, sector: 'Village', mission: 'Protection des habitations', lng: -0.438, lat: 44.584, radiusM: 700, capacity: 0.06, staged: true },
      { id: nextId(), type: 'HBE', count: 2, sector: 'Ouest', mission: 'Freiner la tête du feu', lng: -0.465, lat: 44.591, radiusM: 1500, capacity: 0.08, staged: true },
    ];
    setStagedPlan({ ...plan, deployments, firebreaks: [{ name: 'Ligne nord', sector: 'Nord', lengthKm: 4.2 }], evacuations: [{ name: 'Landiras Est', sector: 'Est', population: 186 }] });
    logTool('stage_deploy_units', '23 moyens prépositionnés en fantôme', 700);
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    await comparePlansWithWorker(['Bouclier village', 'Tenaille mobile', 'Sans renfort'], 6);
  }, [comparePlansWithWorker, logTool, makePlan]);

  const onMapDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('fireops/unit');
    if (!type) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const coordinate = mapRef.current?.unproject([event.clientX - rect.left, event.clientY - rect.top]);
    if (!coordinate) return;
    stageUnit({ type, count: 1, sector: 'Point carte', mission: 'Mission à préciser', lng: coordinate.lng, lat: coordinate.lat, radiusM: 700, capacity: type === 'CCF' ? 0.09 : type === 'HBE' ? 0.08 : 0.06 });
    notify(type + ' ajouté au plan provisoire. Aucune ressource engagée.');
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
  const activeName = scenarioList.find((item) => item.id === activeScenario)?.name || 'Simulation';
  const activeIsBlank = !ignition;
  const simState: 'active' | 'pause' | 'vierge' = !ignition ? 'vierge' : running ? 'active' : 'pause';
  const shownBurnedHa = ignition ? burnedHa : null;
  const shownFrontRate = ignition ? frontRate : null;
  const shownSuppression = ignition ? suppression : null;
  const STATUS_LABEL: Record<string, string> = { eteint: 'Feu éteint', maitrise: 'Maîtrisé', contenu: 'Contenu', libre: 'Libre de progresser' };
  const ATTACK_LABEL: Record<string, string> = { directe: 'Attaque directe possible', 'moyens-lourds': 'Moyens lourds requis', indirect: 'Attaque directe inopérante' };
  const committedCount = committed.reduce((sum, item) => sum + item.count, 0);
  const stagedCount = stagedPlan?.deployments.reduce((sum, item) => sum + item.count, 0) || 0;
  const timeLabel = 'H+' + String(Math.floor(minutes / 60)).padStart(2,'0') + ':' + String(minutes % 60).padStart(2,'0');
  // Horloge de l incident : heure de depart reelle du scenario + temps simule.
  const clockAt = (offset: number) => {
    const total = incident.startHour * 60 + incident.startMinute + offset;
    return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  };
  const incidentClock = incident.dateLabel + ' · ' + clockAt(minutes);
  const timelineMarks = [0, 120, 240, 360, 480].map((offset) => clockAt(offset));

  return (
    <main className="ops-shell">
      <div className={'map-stage view-' + viewMode.toLowerCase() + (pickingIgnition ? ' picking' : '')} aria-label="Carte tactique du feu de Landiras" onDragOver={(event) => event.preventDefault()} onDrop={onMapDrop}>
        <div ref={mapNode} className="maplibre-host" /><div className="map-shade" />
        {stagedPlan?.firebreaks.map((line) => <div key={line.name} className="ghost-firebreak"><span>{line.name} · {line.lengthKm} km</span></div>)}
        {stagedPlan?.evacuations.map((zone) => <div key={zone.name} className="ghost-evac"><span>ZONE PROPOSÉE · {zone.name}</span></div>)}
      </div>

      {!ignition && !pickingIgnition && <div className="blank-cta glass-panel">
        <span className="blank-icon"><Flame size={20} /></span>
        <strong>Carte vierge</strong>
        <p>Aucun foyer n’est placé. Choisissez un point de départ pour lancer la simulation.</p>
        <button className="primary-button" type="button" onClick={() => setPickingIgnition(true)}><Flame size={14} />Placer le foyer</button>
      </div>}

      {pickingIgnition && <div className="pick-hint glass-panel"><Flame size={13} /><span>Cliquez pour placer le foyer — <b>maintenez et glissez</b> pour l’agrandir{draftIgnition && draftIgnition.radiusM > 0 ? ' · rayon ' + Math.round(draftIgnition.radiusM) + ' m' : ''}</span><button type="button" onClick={() => { setPickingIgnition(false); setDraftIgnition(null); }}>Annuler</button></div>}

      <header className="topbar glass-panel">
        <div className="brand-block"><span className="brand-mark"><Flame size={18} /></span><div><strong>FireOps</strong><span>Centre de commandement</span></div></div>
        <div className="scenario-picker">
          <button className={'scenario-title' + (scenarioOpen ? ' open' : '')} type="button" onClick={() => setScenarioOpen((value) => !value)} aria-expanded={scenarioOpen}>
            <span>{activeIsBlank ? 'SIMULATION LIBRE' : incident.ref}</span>
            <strong>{activeName}<ChevronDown size={13} /></strong>
          </button>
          {scenarioOpen && <>
            <div className="popover-shield" role="presentation" onMouseDown={() => setScenarioOpen(false)} />
            <div className="popover scenario-pop glass-panel">
              <div className="popover-head"><span>SIMULATIONS</span><button type="button" onClick={() => { createScenario('blank'); setScenarioOpen(false); }}><Plus size={13} />Nouvelle</button></div>
              <div className="preset-row">
                <span>RECONSTITUTIONS</span>
                <div>
                  <button type="button" onClick={() => { createScenario('saumos'); setScenarioOpen(false); }} title="Gironde — feu de Saumos, 22 juillet 2026">Gironde</button>
                  <button type="button" onClick={() => { createScenario('etoile'); setScenarioOpen(false); }} title="Provence — massif de l’Étoile, exercice mistral">Marseille</button>
                  <button type="button" onClick={() => { createScenario('bug'); setScenarioOpen(false); }} title="Californie — Bug Fire, 8 août 2026">Californie</button>
                </div>
              </div>
              <div className="scenario-list">{scenarioList.map((item) => {
                const isActive = item.id === activeScenario;
                const state = !item.ignition ? 'vierge' : (isActive && running) ? 'active' : 'pause';
                return <button key={item.id} type="button" className={'scenario-row' + (isActive ? ' current' : '')} onClick={() => { if (!isActive) switchScenario(item.id); setScenarioOpen(false); }}>
                  <span className={'sim-dot ' + state} />
                  <span className="scenario-meta"><strong>{item.name}</strong><small>{!item.ignition ? 'Aucun foyer placé' : (item.burnedHa === null ? '—' : item.burnedHa.toLocaleString('fr-FR') + ' ha') + ' · H+' + String(Math.floor(item.minutes / 60)).padStart(2,'0') + ':' + String(item.minutes % 60).padStart(2,'0')}</small></span>
                  <span className={'sim-state ' + state}>{state === 'active' ? 'En cours' : state === 'pause' ? 'En pause' : 'Vierge'}</span>
                </button>;
              })}</div>
              <p className="popover-foot">Changer de simulation met la précédente en pause. Chaque simulation garde son foyer, sa météo et ses moyens.</p>
            </div>
          </>}
        </div>
        <div className="top-actions">
          <button className="demo-button" type="button" onClick={runAgentDemo}><Sparkles size={13} />Agent simulé</button>
          <span className={'status-chip ' + simState}><i />{simState === 'active' ? 'Simulation active' : simState === 'pause' ? 'Simulation en pause' : 'Aucun foyer'}</span>
          <div className="pop-anchor">
            <button className={'icon-button' + (helpOpen ? ' active' : '')} type="button" aria-label="Aide" aria-expanded={helpOpen} onClick={() => setHelpOpen((value) => !value)}><CircleHelp size={17} /></button>
            {helpOpen && <>
              <div className="popover-shield" role="presentation" onMouseDown={() => setHelpOpen(false)} />
              <div className="popover help-pop glass-panel">
                <div className="popover-head"><span>COMMENT LIRE CET ÉCRAN</span><button type="button" onClick={() => setHelpOpen(false)}><X size={13} /></button></div>
                <dl className="help-list">
                  <div><dt>Surface simulée</dt><dd>Aire totale parcourue par le feu depuis l’allumage, calculée cellule par cellule sur une grille de 195 m.</dd></div>
                  <div><dt>Vitesse de tête</dt><dd>Vitesse du front dans l’axe du vent, issue du modèle de Rothermel (1972). Les flancs et l’arrière progressent beaucoup plus lentement.</dd></div>
                  <div><dt>Temps simulé</dt><dd>Minutes écoulées depuis l’allumage. La timeline en bas fait avancer ce compteur.</dd></div>
                  <div><dt>Contour plein / pointillé</dt><dd>Le trait plein est la situation actuelle. Le pointillé est la projection à T+3 h si rien ne change.</dd></div>
                  <div><dt>Calibration</dt><dd>Non réalisée. Aucun écart n’a été mesuré contre un incendie réel : les chiffres sont un ordre de grandeur d’entraînement, pas une prévision.</dd></div>
                </dl>
              </div>
            </>}
          </div>
          <div className="pop-anchor">
            <button className={'avatar-button' + (accountOpen ? ' active' : '')} type="button" aria-expanded={accountOpen} onClick={() => setAccountOpen((value) => !value)} title={userEmail}>{userEmail.slice(0,2).toUpperCase()}</button>
            {accountOpen && <>
              <div className="popover-shield" role="presentation" onMouseDown={() => setAccountOpen(false)} />
              <div className="popover account-pop glass-panel">
                <div className="account-head"><span className="account-avatar">{userEmail.slice(0,2).toUpperCase()}</span><div><strong>{userEmail}</strong><small>Session opérateur</small></div></div>
                <dl className="account-facts">
                  <div><dt>Session</dt><dd>Opaque, côté serveur</dd></div>
                  <div><dt>Mot de passe</dt><dd>Argon2id · 64 Mo</dd></div>
                  <div><dt>Cookie</dt><dd>HttpOnly · SameSite</dd></div>
                  <div><dt>Simulations</dt><dd>{scenarioList.length}</dd></div>
                </dl>
                <p className="account-note"><ShieldCheck size={12} />L’agent WebMCP agit dans cette session. Aucune clé n’est exposée.</p>
                <button className="account-signout" type="button" onClick={signOut}><LogOut size={13} />Se déconnecter</button>
              </div>
            </>}
          </div>
        </div>
      </header>

      {toolStatus === 'unavailable' && <section className="compat-banner glass-panel"><Bot size={16} /><span><strong>WebMCP non détecté.</strong> Activez le flag Chrome ou utilisez le navigateur intégré ChatGPT.</span><button type="button" onClick={runAgentDemo}>Tester l’agent simulé</button></section>}

      <button className={'agent-banner glass-panel ' + toolStatus} type="button" onClick={() => setToolsOpen(true)}>
        <span className="agent-orb">{toolStatus === 'available' ? <Check size={14} /> : <Bot size={14} />}</span>
        <span className="agent-copy"><strong>{toolStatus === 'available' ? 'Agent WebMCP prêt' : toolStatus === 'registering' ? 'Enregistrement des outils…' : 'Mode manuel disponible'}</strong><small>20 outils métier · session de la page</small></span>
        <span className="agent-link">Voir les outils</span>
      </button>

      <aside className={'left-rail glass-panel' + (railOpen ? '' : ' collapsed')}>
        <div className="panel-heading">
          <div><span>RESSOURCES</span><strong>Moyens disponibles</strong></div>
          <span className="resource-count">{PARC_TOTAL}</span>
          <button className="panel-toggle" type="button" aria-expanded={railOpen}
            aria-label={railOpen ? 'Replier les moyens' : 'Déplier les moyens'}
            onClick={() => setRailOpen((value) => !value)}><ChevronUp size={13} /></button>
        </div>
        <p className="drag-hint">Glissez un moyen sur une route, ou cliquez pour le prépositionner</p>
        <div className="autonomy-control">
          <label htmlFor="autonomy">AUTONOMIE À L’ENGAGEMENT</label>
          <input id="autonomy" type="range" min={20} max={100} step={5} value={autonomy}
            onChange={(event) => setAutonomy(Number(event.target.value))} />
          <b>{autonomy} %</b>
        </div>
        <p className="autonomy-note">Un engin à {autonomy} % ne tient que {autonomy} % de son débit théorique : carburant, relève des personnels et chaîne d’eau.</p>
        {FAMILLES.map((famille) => <div className="unit-group" key={famille}>
          <span className="unit-group-head">{famille}</span>
          <div className="unit-list">{units.filter((unit) => unit.famille === famille).map((unit) => <button className="unit-card" type="button" draggable onDragStart={(event) => event.dataTransfer.setData('fireops/unit', unit.code)} onClick={() => { stageUnit({ type: unit.code, count: 1, sector: 'Point d’appui', mission: 'Mission à préciser', lng: domain.lng, lat: domain.lat, radiusM: 900, capacity: 0.08, autonomy }); notify(unit.code + ' ajouté. Aucune ressource engagée.'); }} aria-label={'Prépositionner un ' + unit.code} key={unit.code}><span className={'unit-code fam-' + (unit.famille === 'aérien' ? 'aerien' : unit.famille === 'génie' ? 'genie' : 'terrestre')}>{unit.code}</span><span className="unit-copy"><strong>{unit.label}</strong><small>{unit.cuve} · autonomie {autonomy} %</small></span><b>{String(unit.count).padStart(2,'0')}</b></button>)}</div>
        </div>)}
        <div className="rail-footer"><span><i />{committedCount} engagés</span><span>29 disponibles</span></div>
      </aside>

      <aside className={'situation-panel glass-panel' + (situationOpen ? '' : ' collapsed')}>
        <div className="panel-heading">
          <div><span>{incidentClock}</span><strong>Situation opérationnelle</strong></div>
          <span className="beta-chip">BÊTA</span>
          <button className="panel-toggle" type="button" aria-expanded={situationOpen}
            aria-label={situationOpen ? 'Replier la situation' : 'Déplier la situation'}
            onClick={() => setSituationOpen((value) => !value)}><ChevronUp size={13} /></button>
        </div>
        <div className="metric-grid"><div><span>Surface simulée</span><strong>{shownBurnedHa === null ? '—' : shownBurnedHa.toLocaleString('fr-FR')} <small>ha</small></strong><em>calcul worker</em></div><div><span>Vitesse de tête</span><strong>{shownFrontRate === null ? '—' : shownFrontRate.toLocaleString('fr-FR')} <small>m/min</small></strong><em>calcul Rothermel</em></div><div><span>Temps simulé</span><strong>{minutes} <small>min</small></strong><em>depuis l’allumage</em></div><div><span>Calibration</span><strong>—</strong><em>non réalisée</em></div></div>
        <button className={'weather-card' + (weatherOpen ? ' open' : '')} type="button" onClick={() => setWeatherOpen((value) => !value)} aria-expanded={weatherOpen}>
          <span className="weather-icon"><Wind size={18} /></span>
          <span className="weather-main"><span>VENT {weather.windDirection.toUpperCase()}</span><strong>{weather.windSpeed} <small>km/h</small></strong></span>
          <span className="gust"><span>RAFALES</span><strong>{weather.gusts}</strong></span>
          <span className="weather-caret"><ChevronDown size={14} /></span>
        </button>
        <div className="weather-details"><span><small>TEMP.</small><b>{weather.temperature} °C</b></span><span><small>HUMIDITÉ</small><b>{weather.humidity} %</b></span><span><small>SÉCHERESSE</small><b>{weather.droughtIndex.toFixed(2)}</b></span></div>
        {weatherOpen && <div className="weather-editor">
          <div className="wind-row">
            <div className="wind-dial" role="group" aria-label="Direction du vent">
              <div className="dial-face">
                <i className="dial-needle" style={{ transform: 'rotate(' + weather.windBearing + 'deg)' }} />
                <span className="dial-n">N</span><span className="dial-e">E</span><span className="dial-s">S</span><span className="dial-w">O</span>
              </div>
              <small>{COMPASS[Math.round(weather.windBearing / 45) % 8].label}</small>
            </div>
            <div className="wind-buttons">{COMPASS.map((point) => <button key={point.label} type="button" className={Math.round(weather.windBearing / 45) % 8 === point.index ? 'active' : ''} onClick={() => patchWeather({ windBearing: point.bearing, windDirection: point.from })} title={'Vent de ' + point.from}>{point.short}</button>)}</div>
          </div>
          <Slider label="Force du vent" value={weather.windSpeed} min={0} max={120} unit="km/h" onChange={(windSpeed) => patchWeather({ windSpeed, gusts: Math.max(weather.gusts, Math.round(windSpeed * 1.4)) })} />
          <Slider label="Rafales" value={weather.gusts} min={0} max={160} unit="km/h" onChange={(gusts) => patchWeather({ gusts })} />
          <Slider label="Humidité de l’air" value={weather.humidity} min={5} max={95} unit="%" onChange={(humidity) => patchWeather({ humidity })} />
          <Slider label="Température" value={weather.temperature} min={-5} max={48} unit="°C" onChange={(temperature) => patchWeather({ temperature })} />
          <Slider label="Indice de sécheresse" value={Math.round(weather.droughtIndex * 100)} min={0} max={100} unit="%" onChange={(value) => patchWeather({ droughtIndex: value / 100 })} />
          <div className="weather-presets">
            <span>PRÉRÉGLAGES</span>
            <div>{WEATHER_PRESETS.map((preset) => <button key={preset.label} type="button" onClick={() => { setWeather((current) => ({ ...current, ...preset.values })); logTool('set_weather', preset.label); }}>{preset.label}</button>)}</div>
          </div>
          <p className="weather-note">Vent, direction, température, humidité et sécheresse entrent tous dans le calcul : ils fixent la teneur en eau du combustible fin, donc la vitesse du front.</p>
        </div>}
        {composition.length > 0 && <div className="cover-card">
          <span className="cover-head">COUVERT DOMINANT · {(REGION_LABEL[(terrain?.region) || 'gironde'])}</span>
          {composition.map((entry) => <div className="cover-row" key={entry.nom}>
            <i style={{ width: Math.max(4, entry.part * 100) + '%' }} />
            <span>{entry.nom}</span><b>{(entry.part * 100).toFixed(0)} %</b>
          </div>)}
        </div>}
        {exposure && <div className="exposure-card">
          <span className="cover-head">ENJEUX · {exposure.populationMenacee > 0 ? 'POPULATION MENACÉE' : 'AUCUNE POPULATION EXPOSÉE'}</span>
          <div className="exposure-grid">
            <div><span>Habitants menacés</span><b className={exposure.populationMenacee > 0 ? 'danger' : ''}>{exposure.populationMenacee.toLocaleString('fr-FR')}</b></div>
            <div><span>Habitants atteints</span><b className={exposure.populationAtteinte > 0 ? 'danger' : ''}>{exposure.populationAtteinte.toLocaleString('fr-FR')}</b></div>
            <div><span>Bâti parcouru</span><b>{exposure.surfaceBatieHa.toLocaleString('fr-FR')} <small>ha</small></b></div>
            <div><span>Voies coupées</span><b>{(exposure.pistesCoupeesKm + exposure.routesCoupeesKm).toLocaleString('fr-FR')} <small>km</small></b></div>
          </div>
          <small>Dont {exposure.routesCoupeesKm.toLocaleString('fr-FR')} km de routes ouvertes à la circulation — le reste est du maillage DFCI.</small>
        </div>}
        {shownSuppression && <div className={'suppression-card ' + shownSuppression.status}>
          <div className="supp-head">
            <span className={'supp-dot ' + shownSuppression.status} />
            <strong>{STATUS_LABEL[shownSuppression.status]}</strong>
            <span className={'supp-mode ' + shownSuppression.attackMode}>{ATTACK_LABEL[shownSuppression.attackMode]}</span>
          </div>
          <div className="supp-gauge" aria-label="Couverture hydraulique">
            <i style={{ width: Math.min(100, shownSuppression.containmentRatio * 100) + '%' }} />
          </div>
          <div className="supp-grid">
            <div><span>Débit déployé</span><b className="water">{shownSuppression.deployedFlowLpm.toLocaleString('fr-FR')} <small>L/min</small></b></div>
            <div><span>Débit nécessaire</span><b>{shownSuppression.requiredFlowLpm.toLocaleString('fr-FR')} <small>L/min</small></b></div>
            <div><span>Front actif</span><b>{shownSuppression.activePerimeterM.toLocaleString('fr-FR')} <small>m</small></b></div>
            <div><span>Intensité en tête</span><b className={shownSuppression.attackViable ? '' : 'danger'}>{shownSuppression.firelineIntensityKwM.toLocaleString('fr-FR')} <small>kW/m</small></b></div>
          </div>
          <div className="front-split" aria-label="Répartition du front">
            <div className="front-bars">
              <i className="head" style={{ flexGrow: Math.max(1, shownSuppression.headM) }} title="Tête" />
              <i className="flank" style={{ flexGrow: Math.max(1, shownSuppression.flankM) }} title="Flancs" />
              <i className="rear" style={{ flexGrow: Math.max(1, shownSuppression.rearM) }} title="Arrière" />
            </div>
            <div className="front-legend">
              <span><i className="head" />Tête {shownSuppression.headM.toLocaleString('fr-FR')} m</span>
              <span><i className="flank" />Flancs {shownSuppression.flankM.toLocaleString('fr-FR')} m</span>
              <span><i className="rear" />Arrière {shownSuppression.rearM.toLocaleString('fr-FR')} m</span>
            </div>
            <small>Moyenne sur le périmètre : {shownSuppression.meanIntensityKwM.toLocaleString('fr-FR')} kW/m — l’arrière recule contre le vent et demande peu d’eau.</small>
          </div>
          <p className="supp-verdict">
            {shownSuppression.status === 'eteint' ? 'Le front ne progresse plus.'
              : shownSuppression.containmentMinutes !== null
                ? <>Maîtrise estimée en <b>{shownSuppression.containmentMinutes} min</b> · {shownSuppression.litresPerHour.toLocaleString('fr-FR')} L consommés par heure</>
                : shownSuppression.attackViable
                  ? <>Il manque <b>{Math.max(0, shownSuppression.requiredFlowLpm - shownSuppression.deployedFlowLpm).toLocaleString('fr-FR')} L/min</b> pour tenir le front</>
                  : <>Au-delà de 4 000 kW/m aucun débit ne suffit : ligne d’appui ou attaque indirecte</>}
          </p>
        </div>}
        <p className="model-disclaimer">Modèle Rothermel 1972 · outil d’entraînement · non calibré sur données historiques</p>
      </aside>

      {stagedPlan && <section className="proposal-bar glass-panel"><span className="proposal-icon"><Command size={16} /></span><div><small>PLAN PROVISOIRE · AUCUNE ACTION ENGAGÉE</small><strong>{stagedPlan.name}</strong></div><span className="proposal-summary">{stagedCount} moyens · {stagedPlan.firebreaks.length} ligne · {stagedPlan.evacuations.length} zone</span><button className="danger-button" type="button" onClick={() => { setStagedPlan(null); notify('Plan provisoire annulé. Aucune ressource n’a été engagée.'); }}>Annuler</button><button className="secondary-button" type="button" onClick={() => setComparisonOpen(true)}>Comparer</button><button className="primary-button" type="button" onClick={() => setReviewOpen(true)}>Appliquer</button></section>}
      {!stagedPlan && ignition && <button className="ask-agent glass-panel" type="button" onClick={runAgentDemo}>
        <Sparkles size={14} />Demander un plan à l’agent
      </button>}
      {activities.length > 0 && <button className="activity-pill glass-panel" type="button" onClick={() => setAgentOpen(true)}><Bot size={14} />{activities.length} actions de l’agent<ChevronDown size={13} /></button>}

      <aside className="map-legend glass-panel" aria-label="Légende de la carte">
        <span><i className="lg-scar" />Surface parcourue</span>
        <span><i className="lg-active" />Front en flammes</span>
        <span><i className="lg-forecast" />Position projetée à +3 h</span>
      </aside>
      <nav className="map-controls glass-panel"><button className={pickingIgnition ? 'active' : ''} onClick={() => setPickingIgnition((value) => !value)} title="Placer le point de depart du feu"><Flame size={13} />Foyer</button><button onClick={() => { setIgnition(null); ignitionRef.current = null; setMinutes(0); setCommitted([]); setStagedPlan(null); setUndoStack([]); setRunning(false); setPickingIgnition(true); notify('Simulation réinitialisée.'); }} title="Vider cette simulation"><RotateCcw size={13} />Vider</button><button className={viewMode === '2D' ? 'active' : ''} onClick={() => changeView('2D')}><MapIcon size={13} />2D</button><button className={viewMode === '3D' ? 'active' : ''} onClick={() => changeView('3D')}><Layers3 size={13} />3D</button><button className={viewMode === 'globe' ? 'active' : ''} onClick={() => changeView('globe')}><Globe2 size={13} />Globe</button></nav>
      <section className="timeline glass-panel"><div className="time-readout"><span>HEURE INCIDENT</span><strong>{timeLabel}</strong></div><button className="play-button" type="button" onClick={() => setRunning((value) => !value)}>{running ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button><div className="timeline-track"><div className="track-base"><i style={{ left: Math.min(94, minutes / 7.2) + '%' }} /><b style={{ left: '24%' }} /><b style={{ left: '58%' }} /><b style={{ left: '82%' }} /></div><div className="time-labels">{timelineMarks.map((mark) => <span key={mark}>{mark}</span>)}</div></div><div className="speed-control"><span>VITESSE</span><button type="button" onClick={() => setSpeed((value) => value === 20 ? 50 : value === 50 ? 1 : 20)}>× {speed}</button></div></section>

      {toolsOpen && <Modal onClose={() => setToolsOpen(false)}><section className="tool-catalog glass-panel"><ModalHead icon={<Bot size={18} />} eyebrow="WEBMCP · OUTILS DE LA PAGE" title="Capacités de l’agent" onClose={() => setToolsOpen(false)} /><div className={'connect-state ' + toolStatus}>
  <span className="connect-dot" />
  <div>
    <strong>{toolStatus === 'available' ? 'Outils enregistrés dans cette page' : toolStatus === 'registering' ? 'Enregistrement en cours…' : 'API WebMCP absente de ce navigateur'}</strong>
    <span>{toolStatus === 'available'
      ? 'Ouvrez cette page dans ChatGPT et demandez ce que vous voulez : l’agent découvre les 20 outils ci-dessous et agit sur la carte.'
      : 'Ouvrez cette page dans l’app ChatGPT ou Chrome 149+. Sans l’API, tout reste utilisable à la main et l’agent simulé rejoue un plan complet.'}</span>
  </div>
</div>
<ol className="connect-steps">
  <li><b>1</b><span>Ouvrez cette page dans l’app ChatGPT (ou Chrome 149+ avec le flag WebMCP).</span></li>
  <li><b>2</b><span>Restez connecté : l’agent hérite de votre session, il n’y a ni clé API ni OAuth.</span></li>
  <li><b>3</b><span>Parlez à ChatGPT en langage naturel. Il appelle les outils de la page, jamais l’inverse.</span></li>
  <li><b>4</b><span>Il construit un plan en fantôme sans vous interrompre, puis demande <em>une</em> validation pour tout engager.</span></li>
</ol>
<div className="security-note"><ShieldCheck size={18} /><div><strong>Aucune clé API, aucun accès hors page</strong><span>L’agent agit dans votre session active. Tous les paramètres sont validés avant exécution.</span></div></div><div className="tool-groups">{[['Lecture',toolNames.slice(0,6)],['Provisoire',toolNames.slice(6,11)],['Engagement',toolNames.slice(11,13)],['Simulation & carte',toolNames.slice(13)]].map(([label,names]) => <div key={String(label)}><h3>{String(label)}<span>{(names as string[]).length}</span></h3>{(names as string[]).map((name) => <div className="tool-row" key={name}><code>{name}</code><span>{label === 'Lecture' ? 'Lecture seule' : label === 'Provisoire' ? 'Fantôme · sans confirmation' : label === 'Engagement' ? 'Traçable & annulable' : 'Simulation locale'}</span></div>)}</div>)}</div></section></Modal>}

      {comparisonOpen && <Modal onClose={() => setComparisonOpen(false)}><section className="compare-modal glass-panel"><ModalHead icon={<Layers3 size={18} />} eyebrow="3 EXÉCUTIONS WORKER · T+6H" title="Comparaison des stratégies" onClose={() => setComparisonOpen(false)} /><div className="compare-grid">{(stagedPlan?.comparison || []).map((strategy,index) => <article key={strategy.name} className={index === 0 ? 'recommended' : ''}><header><div><small>{index === 0 ? 'SURFACE MINIMALE' : strategy.resources === 0 ? 'RÉFÉRENCE' : 'ALTERNATIVE'}</small><strong>{strategy.name}</strong></div>{index === 0 && <span><Check size={12} />Résultat calculé</span>}</header><p>{strategy.description}</p><dl><div><dt>Surface simulée</dt><dd>{strategy.burnedHa.toLocaleString('fr-FR')} ha</dd></div><div><dt>Vitesse de tête</dt><dd>{strategy.rateOfSpread.toLocaleString('fr-FR')} m/min</dd></div><div><dt>Moyens</dt><dd>{strategy.resources}</dd></div></dl></article>)}</div><div className="compare-footer"><span>Modèle non calibré · résultats calculés localement</span><button className="primary-button" type="button" onClick={() => { setComparisonOpen(false); setReviewOpen(true); }}>Retenir le résultat minimal</button></div></section></Modal>}

      {reviewOpen && stagedPlan && <Modal><section className="review-panel glass-panel"><ModalHead icon={<Command size={18} />} eyebrow="VALIDATION HUMAINE REQUISE" title="Revue du plan" onClose={rejectPlan} /><div className="intent-card"><small>INTENTION DE L’AGENT</small><p>« {stagedPlan.intention} »</p></div><div className="review-section"><h3>Modifications proposées</h3><ul>{stagedPlan.deployments.map((unit) => <li key={unit.id}><span>+{unit.count} {unit.type}</span><p>{unit.mission} · secteur {unit.sector}</p></li>)}{stagedPlan.firebreaks.map((line) => <li key={line.name}><span>+ Ligne d’appui {line.lengthKm} km</span><p>{line.name} · secteur {line.sector}</p></li>)}{stagedPlan.evacuations.map((zone) => <li key={zone.name}><span>+ Zone d’évacuation</span><p>{zone.name} · {zone.population} personnes · ordre non transmis</p></li>)}</ul></div>{stagedPlan.comparison?.[0] && <div className="impact-card"><div><small>RÉSULTAT CALCULÉ À T+6H</small><strong>{stagedPlan.comparison[0].burnedHa.toLocaleString('fr-FR')} ha<span>surface simulée · modèle non calibré</span></strong></div><div className="impact-bars"><span><i style={{ width: '100%' }} />Vitesse de tête <b>{stagedPlan.comparison[0].rateOfSpread.toLocaleString('fr-FR')} m/min</b></span><span><i style={{ width: '100%' }} />Moyens <b>{stagedPlan.comparison[0].resources}</b></span></div></div>}<details className="edit-details"><summary>Modifier avant d’appliquer <ChevronDown size={14} /></summary><p>Le plan reste éditable sur la carte avant validation.</p></details><div className="review-actions"><button className="secondary-button" type="button" onClick={rejectPlan}>Rejeter</button><button className="primary-button commit-button" type="button" onClick={applyPlan}><Check size={15} />Appliquer le plan · {stagedCount} moyens</button></div><p className="review-legal"><ShieldCheck size={13} />Une seule validation engage ce lot. Chaque action reste annulable.</p></section></Modal>}

      {agentOpen && <aside className="agent-drawer glass-panel"><ModalHead icon={<Bot size={18} />} eyebrow="OFFICIER D’ÉTAT-MAJOR" title="Agent simulé" onClose={() => setAgentOpen(false)} /><div className="agent-prompt"><span>DEMANDE</span><p>« Le vent passe au nord-ouest à 40 km/h. Propose-moi deux stratégies pour protéger le village. »</p></div><div className="activity-list">{activities.length === 0 && <p className="empty-activity">Rejouez un plan complet sans dépendre du flag WebMCP.</p>}{activities.map((activity) => <div key={activity.id}><span className={activity.state}><i>{activity.state === 'done' ? <Check size={11} /> : <TimerReset size={11} />}</i></span><div><code>{activity.tool}</code><p>{activity.label}</p></div><time>{activity.at}</time></div>)}</div><button className="primary-button full-button" type="button" onClick={stagedPlan ? () => { setAgentOpen(false); setReviewOpen(true); } : runAgentDemo}><Sparkles size={14} />{stagedPlan ? 'Ouvrir la revue du plan' : 'Lancer le plan scripté'}</button></aside>}
      {undoStack.length > 0 && <button className="undo-banner glass-panel" type="button" onClick={revertPlan}><Undo2 size={14} />Plan appliqué · Annuler</button>}
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
function Modal({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (onClose && event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (onClose && event.key === 'Escape') onClose(); }}>{children}</div>;
}
function ModalHead({ icon, eyebrow, title, onClose }: { icon: React.ReactNode; eyebrow: string; title: string; onClose: () => void }) {
  return <div className="drawer-heading"><div><span className="drawer-icon">{icon}</span><div><small>{eyebrow}</small><h2>{title}</h2></div></div><button type="button" aria-label="Fermer" onClick={onClose}><X size={18} /></button></div>;
}
