'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl';
import {
  Bot, Check, ChevronDown, CircleHelp, Command, Flame, Globe2, Layers3,
  Map as MapIcon, Pause, Play, ShieldCheck, Sparkles, TimerReset, Undo2, Wind, X,
} from 'lucide-react';

type ViewMode = '2D' | '3D' | 'globe';
type Weather = { windSpeed: number; windDirection: string; gusts: number; temperature: number; humidity: number; droughtIndex: number };
type Deployment = { id: string; type: string; count: number; sector: string; mission: string; lng: number; lat: number; radiusM: number; capacity: number; staged?: boolean };
type StrategyResult = { name: string; burnedHa: number; rateOfSpread: number; resources: number; description: string; deployments: Deployment[] };
type Plan = {
  id: string; name: string; intention: string; deployments: Deployment[];
  tasks: { unitId: string; mission: string }[];
  firebreaks: { name: string; sector: string; lengthKm: number }[];
  evacuations: { name: string; sector: string; population: number }[];
  comparison?: StrategyResult[];
};
type Activity = { id: string; tool: string; label: string; state: 'running' | 'done'; at: string };
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
  windSpeed: 32, windDirection: 'Ouest-nord-ouest', gusts: 47,
  temperature: 38, humidity: 18, droughtIndex: 0.91,
};
const units = [
  { code: 'CCF', count: 18, label: 'Camions-citernes', autonomy: 82 },
  { code: 'FPT', count: 6, label: 'Fourgons pompe', autonomy: 91 },
  { code: 'HBE', count: 2, label: 'Hélicoptères', autonomy: 64 },
  { code: 'DOZ', count: 3, label: 'Bulldozers', autonomy: 76 },
];
const planDescriptions = [
  'Concentration des moyens sur le flanc nord et la lisière du village.',
  'Répartition mobile sur les deux flancs avec une réserve centrale.',
  'Projection de référence sans nouveau moyen engagé.',
];
const defaultIgnition = { lng: -0.4540519, lat: 44.5897472 };
const emptyGeoJSON = { type: 'FeatureCollection', features: [] } as const;
const toolNames = [
  'get_situation', 'list_units', 'get_fire_forecast', 'get_weather', 'query_terrain', 'list_scenarios',
  'propose_plan', 'stage_deploy_units', 'stage_assign_task', 'stage_firebreak', 'stage_evacuation_zone',
  'commit_plan', 'revert_plan', 'run_simulation', 'set_time', 'set_weather', 'ignite', 'compare_plans',
  'focus_region', 'set_view_mode',
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

export default function FireOpsClient({ userEmail }: { userEmail: string }) {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const engineGeoRef = useRef<{ perimeter: unknown; forecast: unknown }>({ perimeter: emptyGeoJSON, forecast: emptyGeoJSON });
  const simulationWorker = useRef<Worker | null>(null);
  const reviewResolver = useRef<((approved: boolean) => void) | null>(null);
  const [toolStatus, setToolStatus] = useState<'registering' | 'available' | 'unavailable'>('registering');
  const [mapReady, setMapReady] = useState(false);
  const [ignition, setIgnition] = useState(defaultIgnition);
  const [pickingIgnition, setPickingIgnition] = useState(false);
  const ignitionRef = useRef(defaultIgnition);
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
  const [burnedHa, setBurnedHa] = useState<number | null>(null);
  const [frontRate, setFrontRate] = useState<number | null>(null);
  const [perimeterGeoJSON, setPerimeterGeoJSON] = useState<unknown>(emptyGeoJSON);
  const [forecastGeoJSON, setForecastGeoJSON] = useState<unknown>(emptyGeoJSON);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(20);
  const [stagedPlan, setStagedPlan] = useState<Plan | null>(null);
  const [committed, setCommitted] = useState<Deployment[]>([
    { id: 'ccf12', type: 'CCF', count: 12, sector: 'Sud-est', mission: 'Défense du village', lng: -0.446, lat: 44.5825, radiusM: 1200, capacity: 0.09 },
    { id: 'fpt04', type: 'FPT', count: 4, sector: 'Sud-ouest', mission: 'Protection des habitations', lng: -0.465, lat: 44.579, radiusM: 700, capacity: 0.06 },
    { id: 'hbe02', type: 'HBE', count: 2, sector: 'Nord-est', mission: 'Attaque aérienne', lng: -0.442, lat: 44.598, radiusM: 1500, capacity: 0.08 },
  ]);
  const [undoStack, setUndoStack] = useState<Deployment[][]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const stateRef = useRef({ weather, minutes, burnedHa, frontRate, stagedPlan, committed, viewMode });

  useEffect(() => {
    stateRef.current = { weather, minutes, burnedHa, frontRate, stagedPlan, committed, viewMode };
  }, [weather, minutes, burnedHa, frontRate, stagedPlan, committed, viewMode]);

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
    setCommitted((current) => [...current, ...stagedPlan.deployments.map((item) => ({ ...item, staged: false }))]);
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
        map.addSource('fire', { type: 'geojson', data: engineGeoRef.current.perimeter as Parameters<GeoJSONSource['setData']>[0] });
        map.addLayer({ id: 'fire-fill', type: 'fill', source: 'fire', paint: { 'fill-color': '#FF3B30', 'fill-opacity': 0.18 } });
        map.addLayer({ id: 'fire-line', type: 'line', source: 'fire', paint: { 'line-color': '#FF3B30', 'line-width': 2, 'line-opacity': 1 } });
        map.addSource('fire-forecast', { type: 'geojson', data: engineGeoRef.current.forecast as Parameters<GeoJSONSource['setData']>[0] });
        map.addLayer({ id: 'fire-forecast-line', type: 'line', source: 'fire-forecast', paint: { 'line-color': '#FF3B30', 'line-width': 2, 'line-opacity': 0.75, 'line-dasharray': [3, 2] } });
        setMapReady(true);
      });
      map.on('click', (event) => {
        if (!pickingRef.current) return;
        setIgnition({ lng: event.lngLat.lng, lat: event.lngLat.lat });
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
    engineGeoRef.current = { perimeter, forecast };
    setBurnedHa(Number(engine.totalBurnedHa));
    setFrontRate(Number(engine.rateOfSpreadMetersPerMinute));
    setPerimeterGeoJSON(perimeter);
    setForecastGeoJSON(forecast);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let marker: Marker | null = null;
    let cancelled = false;
    import('maplibre-gl').then((maplibre) => {
      if (cancelled || !mapRef.current) return;
      const node = document.createElement('div');
      node.className = 'ignition-marker';
      node.title = 'Point d’allumage';
      marker = new maplibre.Marker({ element: node }).setLngLat([ignition.lng, ignition.lat]).addTo(mapRef.current);
    }).catch(() => undefined);
    return () => { cancelled = true; marker?.remove(); };
  }, [ignition, mapReady]);

  useEffect(() => {
    const fireSource = mapRef.current?.getSource('fire') as GeoJSONSource | undefined;
    const forecastSource = mapRef.current?.getSource('fire-forecast') as GeoJSONSource | undefined;
    fireSource?.setData(perimeterGeoJSON as Parameters<GeoJSONSource['setData']>[0]);
    forecastSource?.setData(forecastGeoJSON as Parameters<GeoJSONSource['setData']>[0]);
  }, [forecastGeoJSON, perimeterGeoJSON]);

  useEffect(() => {
    runWorker({ type: 'simulate', ignitionLngLat: ignitionRef.current, reset: true, targetMinutes: minutes, moisture: 0.08, windKph: weather.windSpeed, windDirection: weather.windDirection, slopeDegrees: 7.4, deployments: committed, includeForecast: true })
      .then(applyEngineResult)
      .catch(() => undefined);
  }, [applyEngineResult, committed, minutes, runWorker, weather.windDirection, weather.windSpeed, ignition]);

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
        return new maplibre.Marker({ element }).setLngLat([unit.lng, unit.lat]).addTo(mapRef.current!);
      });
    }).catch(() => undefined);
    return () => { cancelled = true; markersRef.current.forEach((marker) => marker.remove()); markersRef.current = []; };
  }, [committed, mapReady, stagedPlan?.deployments]);

  const comparePlansWithWorker = useCallback(async (names: string[], horizonHours: number) => {
    if (names.length !== 3) throw new Error('compare_plans exige exactement trois stratégies.');
    const placementSets: Deployment[][] = [
      [{ id: nextId(), type: 'CCF', count: 12, sector: 'Sud-est', mission: 'Intercepter la tête du feu', lng: -0.446, lat: 44.5825, radiusM: 1200, capacity: 0.09, staged: true }, { id: nextId(), type: 'DOZ', count: 3, sector: 'Est', mission: 'Ligne d’appui', lng: -0.438, lat: 44.586, radiusM: 700, capacity: 0.07, staged: true }],
      [{ id: nextId(), type: 'CCF', count: 6, sector: 'Nord', mission: 'Tenir le flanc nord', lng: -0.4541, lat: 44.597, radiusM: 900, capacity: 0.09, staged: true }, { id: nextId(), type: 'CCF', count: 6, sector: 'Sud', mission: 'Tenir le flanc sud', lng: -0.449, lat: 44.584, radiusM: 900, capacity: 0.09, staged: true }],
      [],
    ];
    const engineRuns = await Promise.all(placementSets.map((deployments) => {
      return runWorker({
        type: 'simulate', ignitionLngLat: ignitionRef.current, independent: true, targetMinutes: horizonHours * 60, moisture: 0.08,
        windKph: stateRef.current.weather.windSpeed, windDirection: stateRef.current.weather.windDirection,
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
      map?.flyTo({ center: [ignitionRef.current.lng, ignitionRef.current.lat], zoom: 3.2, pitch: 0, duration: 1100 });
    } else if (mode === '3D') {
      map?.setProjection({ type: 'mercator' });
      map?.setTerrain({ source: 'terrain-dem', exaggeration: 1.35 });
      map?.easeTo({ center: [ignitionRef.current.lng, ignitionRef.current.lat], zoom: 11.2, pitch: 62, bearing: -18, duration: 900 });
    } else {
      map?.setTerrain(null);
      map?.setProjection({ type: 'mercator' });
      map?.easeTo({ center: [ignitionRef.current.lng, ignitionRef.current.lat], zoom: 11.2, pitch: 0, bearing: 0, duration: 700 });
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
            const result = await runWorker({ type: 'simulate', ignitionLngLat: ignitionRef.current, independent: true, targetMinutes: hours * 60, moisture: 0.08, windKph: stateRef.current.weather.windSpeed, windDirection: stateRef.current.weather.windDirection, slopeDegrees: 7.4, deployments: stateRef.current.committed });
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
          const engine = await runWorker({ type: 'simulate', ignitionLngLat: ignitionRef.current, reset: true, targetMinutes: value, moisture: 0.08, windKph: stateRef.current.weather.windSpeed, windDirection: stateRef.current.weather.windDirection, slopeDegrees: 7.4, deployments: stateRef.current.committed, includeForecast: true });
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
            moisture: 0.08, windKph: stateRef.current.weather.windSpeed, windDirection: stateRef.current.weather.windDirection,
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
        execute: (input) => { const region = textValue(input.region, 'region', 20); mapRef.current?.flyTo({ center: [ignitionRef.current.lng, ignitionRef.current.lat], zoom: 11.2, duration: 1000 }); return { focused: region }; },
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
  const committedCount = committed.reduce((sum, item) => sum + item.count, 0);
  const stagedCount = stagedPlan?.deployments.reduce((sum, item) => sum + item.count, 0) || 0;
  const timeLabel = 'H+' + String(Math.floor(minutes / 60)).padStart(2,'0') + ':' + String(minutes % 60).padStart(2,'0');

  return (
    <main className="ops-shell">
      <div className={'map-stage view-' + viewMode.toLowerCase() + (pickingIgnition ? ' picking' : '')} aria-label="Carte tactique du feu de Landiras" onDragOver={(event) => event.preventDefault()} onDrop={onMapDrop}>
        <div ref={mapNode} className="maplibre-host" /><div className="map-shade" />
        {stagedPlan?.firebreaks.map((line) => <div key={line.name} className="ghost-firebreak"><span>{line.name} · {line.lengthKm} km</span></div>)}
        {stagedPlan?.evacuations.map((zone) => <div key={zone.name} className="ghost-evac"><span>ZONE PROPOSÉE · {zone.name}</span></div>)}
      </div>

      {pickingIgnition && <div className="pick-hint glass-panel"><Flame size={13} />Cliquez sur la carte pour placer le point de depart du feu<button type="button" onClick={() => setPickingIgnition(false)}>Annuler</button></div>}

      <header className="topbar glass-panel">
        <div className="brand-block"><span className="brand-mark"><Flame size={18} /></span><div><strong>FireOps</strong><span>Centre de commandement</span></div></div>
        <div className="scenario-title"><span>INCIDENT 33-2022-0712</span><strong>Landiras · Gironde</strong></div>
        <div className="top-actions"><button className="demo-button" type="button" onClick={runAgentDemo}><Sparkles size={13} />Agent simulé</button><span className="status-chip"><i />Simulation active</span><button className="icon-button" type="button" aria-label="Aide"><CircleHelp size={17} /></button><button className="avatar-button" type="button" onClick={signOut} title={'Déconnecter ' + userEmail}>{userEmail.slice(0,2).toUpperCase()}</button></div>
      </header>

      {toolStatus === 'unavailable' && <section className="compat-banner glass-panel"><Bot size={16} /><span><strong>WebMCP non détecté.</strong> Activez le flag Chrome ou utilisez le navigateur intégré ChatGPT.</span><button type="button" onClick={runAgentDemo}>Tester l’agent simulé</button></section>}

      <button className={'agent-banner glass-panel ' + toolStatus} type="button" onClick={() => setToolsOpen(true)}>
        <span className="agent-orb">{toolStatus === 'available' ? <Check size={14} /> : <Bot size={14} />}</span>
        <span className="agent-copy"><strong>{toolStatus === 'available' ? 'Agent WebMCP prêt' : toolStatus === 'registering' ? 'Enregistrement des outils…' : 'Mode manuel disponible'}</strong><small>20 outils métier · session de la page</small></span>
        <span className="agent-link">Voir les outils</span>
      </button>

      <aside className="left-rail glass-panel">
        <div className="panel-heading"><div><span>RESSOURCES</span><strong>Moyens disponibles</strong></div><span className="resource-count">29</span></div>
        <p className="drag-hint">Glissez un moyen sur une route, ou cliquez pour le prépositionner</p>
        <div className="unit-list">{units.map((unit) => <button className="unit-card" type="button" draggable onDragStart={(event) => event.dataTransfer.setData('fireops/unit', unit.code)} onClick={() => { stageUnit({ type: unit.code, count: 1, sector: 'Point d’appui est', mission: 'Mission à préciser', lng: -0.442, lat: 44.585, radiusM: 700, capacity: unit.code === 'CCF' ? 0.09 : unit.code === 'HBE' ? 0.08 : 0.06 }); notify(unit.code + ' ajouté au point d’appui est. Aucune ressource engagée.'); }} aria-label={'Prépositionner un ' + unit.code + ' au point d’appui est'} key={unit.code}><span className="unit-code">{unit.code}</span><span className="unit-copy"><strong>{unit.label}</strong><small>Prêt · autonomie {unit.autonomy} %</small></span><b>{String(unit.count).padStart(2,'0')}</b></button>)}</div>
        <div className="rail-footer"><span><i />{committedCount} engagés</span><span>29 disponibles</span></div>
      </aside>

      <aside className="situation-panel glass-panel">
        <div className="panel-heading"><div><span>12 JUIL. 2022 · {String(14 + Math.floor(minutes / 60)).padStart(2,'0')}:{String(minutes % 60).padStart(2,'0')}</span><strong>Situation opérationnelle</strong></div><span className="beta-chip">BÊTA</span></div>
        <div className="metric-grid"><div><span>Surface simulée</span><strong>{burnedHa === null ? '—' : burnedHa.toLocaleString('fr-FR')} <small>ha</small></strong><em>calcul worker</em></div><div><span>Vitesse de tête</span><strong>{frontRate === null ? '—' : frontRate.toLocaleString('fr-FR')} <small>m/min</small></strong><em>calcul Rothermel</em></div><div><span>Temps simulé</span><strong>{minutes} <small>min</small></strong><em>depuis l’allumage</em></div><div><span>Calibration</span><strong>—</strong><em>non réalisée</em></div></div>
        <div className="weather-card"><div className="weather-icon"><Wind size={18} /></div><div><span>VENT {weather.windDirection.toUpperCase()}</span><strong>{weather.windSpeed} <small>km/h</small></strong></div><div className="gust"><span>RAFALES</span><strong>{weather.gusts}</strong></div></div>
        <div className="weather-details"><span><small>TEMP.</small><b>{weather.temperature} °C</b></span><span><small>HUMIDITÉ</small><b>{weather.humidity} %</b></span><span><small>SÉCHERESSE</small><b>{weather.droughtIndex.toFixed(2)}</b></span></div>
        <p className="model-disclaimer">Modèle Rothermel 1972 · outil d’entraînement · non calibré sur données historiques</p>
      </aside>

      {stagedPlan && <section className="proposal-bar glass-panel"><span className="proposal-icon"><Command size={16} /></span><div><small>PLAN PROVISOIRE · AUCUNE ACTION ENGAGÉE</small><strong>{stagedPlan.name}</strong></div><span className="proposal-summary">{stagedCount} moyens · {stagedPlan.firebreaks.length} ligne · {stagedPlan.evacuations.length} zone</span><button className="secondary-button" type="button" onClick={() => setComparisonOpen(true)}>Comparer</button><button className="primary-button" type="button" onClick={() => setReviewOpen(true)}>Revoir et appliquer</button></section>}
      {activities.length > 0 && <button className="activity-pill glass-panel" type="button" onClick={() => setAgentOpen(true)}><Bot size={14} />{activities.length} actions de l’agent<ChevronDown size={13} /></button>}

      <nav className="map-controls glass-panel"><button className={pickingIgnition ? 'active' : ''} onClick={() => setPickingIgnition((value) => !value)} title="Placer le point de depart du feu"><Flame size={13} />Foyer</button><button className={viewMode === '2D' ? 'active' : ''} onClick={() => changeView('2D')}><MapIcon size={13} />2D</button><button className={viewMode === '3D' ? 'active' : ''} onClick={() => changeView('3D')}><Layers3 size={13} />3D</button><button className={viewMode === 'globe' ? 'active' : ''} onClick={() => changeView('globe')}><Globe2 size={13} />Globe</button></nav>
      <section className="timeline glass-panel"><div className="time-readout"><span>HEURE INCIDENT</span><strong>{timeLabel}</strong></div><button className="play-button" type="button" onClick={() => setRunning((value) => !value)}>{running ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button><div className="timeline-track"><div className="track-base"><i style={{ left: Math.min(94, minutes / 7.2) + '%' }} /><b style={{ left: '24%' }} /><b style={{ left: '58%' }} /><b style={{ left: '82%' }} /></div><div className="time-labels"><span>14:00</span><span>16:00</span><span>18:00</span><span>20:00</span><span>22:00</span></div></div><div className="speed-control"><span>VITESSE</span><button type="button" onClick={() => setSpeed((value) => value === 20 ? 50 : value === 50 ? 1 : 20)}>× {speed}</button></div></section>

      {toolsOpen && <Modal onClose={() => setToolsOpen(false)}><section className="tool-catalog glass-panel"><ModalHead icon={<Bot size={18} />} eyebrow="WEBMCP · OUTILS DE LA PAGE" title="Capacités de l’agent" onClose={() => setToolsOpen(false)} /><div className="security-note"><ShieldCheck size={18} /><div><strong>Aucune clé API, aucun accès hors page</strong><span>L’agent agit dans votre session active. Tous les paramètres sont validés avant exécution.</span></div></div><div className="tool-groups">{[['Lecture',toolNames.slice(0,6)],['Provisoire',toolNames.slice(6,11)],['Engagement',toolNames.slice(11,13)],['Simulation & carte',toolNames.slice(13)]].map(([label,names]) => <div key={String(label)}><h3>{String(label)}<span>{(names as string[]).length}</span></h3>{(names as string[]).map((name) => <div className="tool-row" key={name}><code>{name}</code><span>{label === 'Lecture' ? 'Lecture seule' : label === 'Provisoire' ? 'Fantôme · sans confirmation' : label === 'Engagement' ? 'Traçable & annulable' : 'Simulation locale'}</span></div>)}</div>)}</div></section></Modal>}

      {comparisonOpen && <Modal onClose={() => setComparisonOpen(false)}><section className="compare-modal glass-panel"><ModalHead icon={<Layers3 size={18} />} eyebrow="3 EXÉCUTIONS WORKER · T+6H" title="Comparaison des stratégies" onClose={() => setComparisonOpen(false)} /><div className="compare-grid">{(stagedPlan?.comparison || []).map((strategy,index) => <article key={strategy.name} className={index === 0 ? 'recommended' : ''}><header><div><small>{index === 0 ? 'SURFACE MINIMALE' : strategy.resources === 0 ? 'RÉFÉRENCE' : 'ALTERNATIVE'}</small><strong>{strategy.name}</strong></div>{index === 0 && <span><Check size={12} />Résultat calculé</span>}</header><p>{strategy.description}</p><dl><div><dt>Surface simulée</dt><dd>{strategy.burnedHa.toLocaleString('fr-FR')} ha</dd></div><div><dt>Vitesse de tête</dt><dd>{strategy.rateOfSpread.toLocaleString('fr-FR')} m/min</dd></div><div><dt>Moyens</dt><dd>{strategy.resources}</dd></div></dl></article>)}</div><div className="compare-footer"><span>Modèle non calibré · résultats calculés localement</span><button className="primary-button" type="button" onClick={() => { setComparisonOpen(false); setReviewOpen(true); }}>Retenir le résultat minimal</button></div></section></Modal>}

      {reviewOpen && stagedPlan && <Modal><section className="review-panel glass-panel"><ModalHead icon={<Command size={18} />} eyebrow="VALIDATION HUMAINE REQUISE" title="Revue du plan" onClose={rejectPlan} /><div className="intent-card"><small>INTENTION DE L’AGENT</small><p>« {stagedPlan.intention} »</p></div><div className="review-section"><h3>Modifications proposées</h3><ul>{stagedPlan.deployments.map((unit) => <li key={unit.id}><span>+{unit.count} {unit.type}</span><p>{unit.mission} · secteur {unit.sector}</p></li>)}{stagedPlan.firebreaks.map((line) => <li key={line.name}><span>+ Ligne d’appui {line.lengthKm} km</span><p>{line.name} · secteur {line.sector}</p></li>)}{stagedPlan.evacuations.map((zone) => <li key={zone.name}><span>+ Zone d’évacuation</span><p>{zone.name} · {zone.population} personnes · ordre non transmis</p></li>)}</ul></div>{stagedPlan.comparison?.[0] && <div className="impact-card"><div><small>RÉSULTAT CALCULÉ À T+6H</small><strong>{stagedPlan.comparison[0].burnedHa.toLocaleString('fr-FR')} ha<span>surface simulée · modèle non calibré</span></strong></div><div className="impact-bars"><span><i style={{ width: '100%' }} />Vitesse de tête <b>{stagedPlan.comparison[0].rateOfSpread.toLocaleString('fr-FR')} m/min</b></span><span><i style={{ width: '100%' }} />Moyens <b>{stagedPlan.comparison[0].resources}</b></span></div></div>}<details className="edit-details"><summary>Modifier avant d’appliquer <ChevronDown size={14} /></summary><p>Le plan reste éditable sur la carte avant validation.</p></details><div className="review-actions"><button className="secondary-button" type="button" onClick={rejectPlan}>Rejeter</button><button className="primary-button commit-button" type="button" onClick={applyPlan}><Check size={15} />Appliquer le plan · {stagedCount} moyens</button></div><p className="review-legal"><ShieldCheck size={13} />Une seule validation engage ce lot. Chaque action reste annulable.</p></section></Modal>}

      {agentOpen && <aside className="agent-drawer glass-panel"><ModalHead icon={<Bot size={18} />} eyebrow="OFFICIER D’ÉTAT-MAJOR" title="Agent simulé" onClose={() => setAgentOpen(false)} /><div className="agent-prompt"><span>DEMANDE</span><p>« Le vent passe au nord-ouest à 40 km/h. Propose-moi deux stratégies pour protéger le village. »</p></div><div className="activity-list">{activities.length === 0 && <p className="empty-activity">Rejouez un plan complet sans dépendre du flag WebMCP.</p>}{activities.map((activity) => <div key={activity.id}><span className={activity.state}><i>{activity.state === 'done' ? <Check size={11} /> : <TimerReset size={11} />}</i></span><div><code>{activity.tool}</code><p>{activity.label}</p></div><time>{activity.at}</time></div>)}</div><button className="primary-button full-button" type="button" onClick={stagedPlan ? () => { setAgentOpen(false); setReviewOpen(true); } : runAgentDemo}><Sparkles size={14} />{stagedPlan ? 'Ouvrir la revue du plan' : 'Lancer le plan scripté'}</button></aside>}
      {undoStack.length > 0 && <button className="undo-banner glass-panel" type="button" onClick={revertPlan}><Undo2 size={14} />Plan appliqué · Annuler</button>}
      {toast && <div className="toast glass-panel" role="status"><Check size={15} />{toast}</div>}
    </main>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (onClose && event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (onClose && event.key === 'Escape') onClose(); }}>{children}</div>;
}
function ModalHead({ icon, eyebrow, title, onClose }: { icon: React.ReactNode; eyebrow: string; title: string; onClose: () => void }) {
  return <div className="drawer-heading"><div><span className="drawer-icon">{icon}</span><div><small>{eyebrow}</small><h2>{title}</h2></div></div><button type="button" aria-label="Fermer" onClick={onClose}><X size={18} /></button></div>;
}
