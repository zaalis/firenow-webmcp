# FireNow

FireNow is an agent-native wildfire decision-support and training simulator. The map stays under human control, while a WebMCP-capable agent can read the situation, build a complete plan in a ghost layer, compare several strategies, and submit the batch for a single human approval.

> **Training beta.** FireNow is not a certified incident command system. It replaces neither the incident commander, nor field data, nor local procedure. The engine is not calibrated: see [Engine validation](#engine-validation) for the measured deviations.

## Why WebMCP

FireNow calls no language model. The page registers **21 domain tools** on the browser-provided `document.modelContext`. ChatGPT discovers them as site tools in its built-in desktop browser and uses the session already open in the page:

- read tools marked `readOnlyHint`;
- staging tools that only ever draw into a ghost plan;
- commit and revert tools;
- simulation and navigation tools.

`commit_plan` is the only stopping point in the normal flow: it calls `requestUserInteraction()` when the client provides one, opens the plan review, and waits for the human decision. Tools are retired when the page unmounts, and therefore at sign-out. Parameters received from the agent are validated as untrusted input.

The **WebMCP log** shows the calls the agent actually executed, with the tool, its result and a timestamp. There is no simulated agent or manual tool runner in the page.

### Native first, and a bridge that yields to it

FireNow registers its tools on `document.modelContext`. When ChatGPT's built-in browser supplies that API natively, that is the whole story: top-level registration through `document.modelContext.registerTool()`, discovered as site tools, nothing else in the way.

Every other browser gets the same context from `public/webmcp.js`, loaded before hydration. Without it the page exposes no tools at all and any agent — Claude in Chrome, an MCP extension, a plain Chrome tab — sees a mute map.

The risk a page-owned fallback carries is that it squats the namespace the browser means to use: if the native implementation is installed *after* the page scripts run, a getter-only property makes that installation fail silently and the page keeps talking to a private map no agent can discover. The bridge is written so that cannot happen. It steps aside when a native context already exists, and the property it defines otherwise is read **and** write: the setter adopts the incoming native implementation and re-registers every tool onto it. Native always wins, whenever it arrives.

On top of the model context the bridge publishes the same implementation on two further surfaces, because the agents that open this page do not all have the same reach:

- `window.__WEBMCP__` — an agent evaluating JavaScript in the main world;
- `webmcp:call` / `webmcp:result` DOM events and same-origin `postMessage`, described in the `#webmcp-manifest` JSON block — an extension content script, which runs in an isolated world and can see neither the model context nor `window.__WEBMCP__`.

Every transport runs the same tool implementation: same validation, same journal, same human approval on `commit_plan`.

All of this is addressed to agents and none of it to operators. The page carries no tool panel, no MCP catalogue and no manual call form: what a human sees is the map, and the WebMCP log of the calls an agent actually made.

Retirement follows the specification: tools are registered with an `AbortSignal` that the component teardown fires.

The front door registers two read-only tools of its own, `get_capabilities` and `open_console`, so that an agent arriving before sign-in finds a model context that answers rather than an empty one.

## The engine

A 128 × 128 cellular automaton, priority-queue spread, fifteen-minute sub-steps, running in a Web Worker.

- **Rothermel (1972), two classes** — dead and live fuel, with separate moisture damping and heat sinks. No per-species tuning coefficient: spread rates are compared against published ranges, not fitted to a fire.
- **Standard fuel models** (Anderson 1982, Scott & Burgan 2005): 15 models, from grass mat to conifer litter.
- **A register of 35 real species** across 5 ecological regions — Landes de Gascogne, Provence limestone, Great Basin, cismontane chaparral, Sierra Nevada. Each species declares its share of ground cover per region.
- **Landscape anchored to coordinates**: a place keeps its vegetation whatever the framing or window extent.
- **Byram fireline intensity**, operational thresholds at 2,000 and 4,000 kW/m, with the front split into head, flanks and rear.
- **Alexander (1985) ellipse** for the length-to-breadth ratio.
- **Spotting** driven by flame length and wind, with a plume-dominated regime.
- **The human landscape of the Landes**: DFCI track grid, roads, buildings and statutory clearing. A break delays the front while the flame is shorter than the break is wide; it is never an absolute barrier.
- **Human exposure**: residents threatened and reached, built area burned, routes cut. Outside a described massif, no figure is produced.
- **Suppression**: 13 unit types with manufacturer tank, pump rate and refill time; sustainable duty bounds the flow actually held; control lines built during a run are cumulative and persistent.
- **A diurnal cycle** and a real hourly weather series (Open-Meteo archive) for multi-day runs.

## Scenarios

Five entries: Landiras I (Gironde, July 2022), Saumos (Gironde, July 2026), the Étoile massif (Provence, an **exercise** rather than a historical fire), Bug Fire (California, August 2026), and a blank simulation.

## Engine validation

The `scripts/validate-fires.mjs` harness replays reference fires and computes a perimeter overlap (Jaccard) alongside the area deviation. **It changes no coefficient.** Detailed results in [`validation-data/results-before-after.md`](validation-data/results-before-after.md).

State measured on 28 August 2026:

- the three structural criteria are moving the right way — overnight growth brought down from 27 % to 19.4 % of final area, growth now discontinuous, and committed units avoiding 51.6 % of burned area inside the model;
- **absolute accuracy is not there**: Saumos 2026 is under-predicted by 92 %, Saumos 2022 over-predicted by 158 %, with a perimeter Jaccard of 0.171;
- no calibration multiplier has been introduced to hide those gaps.

The two Saumos runs miss in opposite directions, which is the signature of a mis-specified rule rather than a wrong constant. `scripts/ablate-calibration.mjs` varies one term at a time and names it:

| Free-spread run (no units) | Saumos 2022 (3,248 ha real) | Saumos 2026 (42,000 ha real) |
| --- | ---: | ---: |
| baseline, as shipped | 8,381 ha (+158 %) | 6,653 ha (−84 %) |
| **edge extinction disabled** | 52,498 ha (+1516 %) | **43,701 ha (+4 %)** |
| diurnal damping removed | 33,596 ha (+934 %) | 23,636 ha (−44 %) |
| hourly weather ignored | 13,592 ha (+318 %) | 12,436 ha (−70 %) |
| midflame WAF 0.25 → 0.5 | 8,381 ha (unchanged) | 6,653 ha (unchanged) |

Two conclusions follow. First, **permanent edge extinction is the dominant term**: switching it off alone brings Saumos 2026 to within 4 % of the observed area, and blows Saumos 2022 up by a factor of sixteen. One fixed rule — extinguish a perimeter cell for good once it stays below 500 kW/m for 45 minutes — is doing nearly all the work of bounding fire size, and it is too weak for a mild fire and far too strong for a severe one. Second, `MIDFLAME_FACTOR` is dead code: every fuel model defines its own `waf`, so the constant is never read.

The "not calibrated against historical fires" banner stays in the interface while these gaps remain.

## Getting started

Requirements: Node.js 22.13 or newer.

    npm install
    npm run dev

Open http://localhost:3000. The root serves the presentation page; the "Access" section opens the console. A five-step tutorial runs the first time a new account opens the console, and stays available from the help menu.

Authentication routes are served by the same local Worker so that cookies stay same-origin.

## Verification

    npm run lint
    npm run build
    node scripts/test-simulation.mjs
    node scripts/validate-fires.mjs

For the real integration check, open the signed-in console in the ChatGPT desktop app's built-in browser. The address-bar Site tools menu must list 21 tools. Ask ChatGPT to read the operational situation and verify that the WebMCP log records a `get_situation` call; no map click or form submission should occur.

In a browser without native WebMCP support, the page bridge supplies the context instead. Check it from any console:

    window.__WEBMCP__.mode                        // 'native' or 'polyfill'
    window.__WEBMCP__.listTools().length          // 21 once signed in
    await window.__WEBMCP__.callTool('get_situation', {})

A staging call is the check that matters, because it proves the agent path end to end: `await window.__WEBMCP__.callTool('propose_plan', { name: 'West flank', intention: 'Hold the DFCI track' })` must raise the draft plan bar and appear in the WebMCP log.

The `test-simulation.mjs` suite carries **48 assertions**: spread rates against published ranges, regional composition, geographic anchoring of the landscape, perimeter geometry, weather response, suppression response, sustainable duty, DFCI grid behaviour and numerical robustness.

## Architecture

    app/
      firenow-client.tsx        map, state, review and WebMCP tools
      landing-tools.tsx         the two read-only tools of the front door
      tool-names.ts             the catalogue quoted to agents before sign-in
      landing.tsx               public presentation page
      login-client.tsx          human authentication
      tour.tsx                  five-step spotlight tutorial
      globals.css               visual system
      api/auth/*                CSRF, registration, sign-in, sign-out
    brand/
      firenow.jpg               source mark, input to the asset build
    db/
      auth.ts                   registration, sign-in, sessions, rate limiting
      schema.ts                 D1 schema
    drizzle/                    SQL migration
    public/
      webmcp.js                 WebMCP bridge, loaded before hydration
      brand/                    generated marks
      media/                    public-domain photographs
      simulation.worker.js      spread engine
      maplibre/                 MapLibre worker served by the application
      data/                     pre-computed Gironde territorial raster
    scripts/
      build-brand-assets.mjs    favicons, marks and the Open Graph image
      test-simulation.mjs       engine test suite
      validate-fires.mjs        multi-fire validation harness
      ablate-calibration.mjs    isolates which term drives the calibration gaps
      sync-maplibre-worker.mjs  copies the MapLibre worker into public/
      build-gironde-landscape.mjs  builds the Gironde raster
      fetch-fire-weather.mjs    fetches the hourly series
    validation-data/            reference perimeters, weather, results
    design-system/fireops/      visual specification (stale, see Known limits)
    docs/                       demo script and submission text

## Brand assets

Every icon, mark and social image is derived from a single source, `brand/firenow.jpg`:

    node scripts/build-brand-assets.mjs

The mark is dark-green line art on white. It reads correctly on a light tile and disappears on the near-black console, so the source is turned into an alpha mask once and tinted twice — green for light surfaces, white for dark ones.

## The MapLibre worker

MapLibre derives its worker URL from its own `import.meta.url`. Once bundled by Vite, that URL points at a file the bundler never emits: the worker 404s, no GeoJSON source loads and **no vector layer is drawn at all** — the fire disappears and only the DOM markers remain. The fault shows only in production, since `maplibre-gl` is excluded from dependency optimisation in development.

The application therefore serves the official worker from `public/maplibre/` and calls `setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')` before creating the map. Both copied files (`maplibre-gl-worker.mjs` and the `maplibre-gl-shared.mjs` module it imports) are versioned so that no deployment step is required, and `npm run sync:maplibre-worker` — which runs automatically before `dev` and `build` — brings them back in step after a `maplibre-gl` upgrade.

## Data sources

- Esri Canvas basemap (base and labels), with no API key;
- BD Forêt and BD TOPO (IGN) under the Licence Ouverte, INSEE 200 m population grid, Open-Meteo elevation for the Gironde raster;
- Open-Meteo hourly archive for scenario weather;
- Copernicus EMS EMSR633 perimeter for the Saumos 2022 validation;
- photographs in `public/media/` are public domain (U.S. Fish and Wildlife Service, U.S. Air Force, National Park Service, NASA), credited in the page footer.

## References

- [OpenAI — Site tools / WebMCP](https://learn.chatgpt.com/docs/webmcp)
- [WebMCP specification](https://webmachinelearning.github.io/webmcp/)
- Rothermel, R. C. (1972), *A mathematical model for predicting fire spread in wildland fuels*
- Anderson, H. E. (1982), *Aids to determining fuel models for estimating fire behavior*
- Scott, J. H. & Burgan, R. E. (2005), *Standard fire behavior fuel models*
- Alexander, M. E. (1985), elliptical front geometry
- Byram, G. M. (1959), fireline intensity

## Known limits

- **The engine is not calibrated.** The measured deviations are published above rather than corrected by a tuning factor.
- The real territorial raster covers only the Gironde; other regions use a procedural mosaic anchored to coordinates, with no real roads or buildings.
- Elevation is sampled at 90 m; the 30 m DEM now requires an authenticated licence acceptance.
- No usable vector perimeter was found for Saumos 2026, so the shape score is available for 2022 only.
- Evacuation orders are never transmitted to any external system.
- Site tools require a current ChatGPT desktop built-in browser, an eligible model and account rollout, and the Enable site tools permission. Ordinary Chrome does not receive a page-owned fallback.
- Field mobile testing and professional validation by firefighters have not been done.
- The basemap is served up to zoom level 16; beyond that the last tile is stretched.
- The MapLibre bundle exceeds the 500 kB warning and would benefit from code splitting.
- `npm run start` does not boot locally: the server imports `cloudflare:workers`, which the Node ESM loader refuses. `npm run dev` already runs the server code inside the Workers runtime through the Cloudflare Vite plugin; that is where local verification happens.
- `design-system/fireops/MASTER.md` is a stale generated artefact. Its palette and typography do not match what is implemented; the code is the source of truth.

## Licence

MIT — see [LICENSE](LICENSE).
