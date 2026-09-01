# FireNow — submission text

## Summary

FireNow turns an agent into a staff officer inside a wildfire simulator. The human keeps the map and the authority; the agent can read the situation, build a complete plan as a ghost layer, compare several strategies against a local physics engine, then ask for a single human approval to commit the batch.

## What makes the WebMCP integration deep

FireNow exposes twenty-one tools designed around operational intent rather than as CRUD wrappers. Separating read, draft and commit solves the problem of numerous agentic actions: the agent can stage fifty vehicles without interrupting the officer, because no resource is committed before `commit_plan`. That call uses `requestUserInteraction()` and stays suspended for the whole visual plan review.

The page calls no language model. The agent operates inside the authenticated page, shares its session cookie, and the tools disappear at sign-out. Parameters received from the agent are validated as untrusted input.

Because `document.modelContext` does not yet exist in a mainstream browser, the page provides its own model context when the browser has none — without ever replacing a native implementation. The tools are therefore genuinely callable today, in Chrome: from a native WebMCP client the day one exists, from an agent that evaluates JavaScript in the tab (`window.__WEBMCP__.callTool`), and from an extension content script — which runs in an isolated world and reaches neither of those — over a same-origin `postMessage` channel or a `webmcp:call` DOM event.

All of those are JavaScript, and the agent most people will actually point at this page has none of them: ChatGPT drives a tab through screenshots and the accessibility tree. It reads "21 WebMCP tools live" in the header and can call nothing. So the tools are also published **in the DOM**, in an agent bridge under the header: the directive, the catalogue with signatures and descriptions, a form that takes a tool name and JSON arguments, and a result pane — plus invocation by navigation, `/?tool=NAME&args=JSON`, for an agent whose only verb is opening a URL. Both routes run the same `callTool`, with the same validation, the same log and the same single human approval on `commit_plan`, which is the one tool the URL route refuses.

## The engine, and what it does not claim to be

A 128 × 128 cellular automaton in a Web Worker: two-class Rothermel with no per-species tuning coefficient, standard Anderson and Scott & Burgan fuel models, a register of 35 real species across 5 ecological regions, Byram intensity, the Alexander ellipse, spotting, the DFCI track grid of the Landes massif, and human exposure.

The landscape is generated from geographic coordinates: it exists independently of any fire and knows about no scenario. No historical fire is scripted.

**The engine is not calibrated, and the repository says so.** The `validate-fires.mjs` harness measures perimeter overlap against Copernicus EMS data. As of 28 August 2026, Saumos 2026 is under-predicted by 92 % and Saumos 2022 over-predicted by 158 %, for a Jaccard of 0.171. Those deviations are published in `validation-data/results-before-after.md` rather than masked by an adjustment factor. They miss in opposite directions, which points at a missing driver — fuel moisture conditioning and the wind profile over the canopy — rather than at a wrong constant.

## Impact

The goal is not to predict a fire, but to make it fast to test options, compare their consequences, and train reasoning under constraint: front intensity, feasible attack mode, sufficiency of committed flow, who is exposed. On those questions the model is usable over a few hours. Over several days it is not yet, and the interface says so.

## Technology

Imperative WebMCP, React/Vite through Vinext, MapLibre GL on an Esri raster basemap, a Web Worker, Cloudflare D1, Lucide.

## Status

Training beta. Five scenarios: Landiras I (2022), Saumos (2026), the Étoile massif (exercise), Bug Fire (California 2026) and a blank simulation. Still to do: real territorial coverage outside the Gironde, 30 m elevation, vector perimeters for 2026, and professional validation by firefighters.
