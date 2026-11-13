# STEP 1 — System audit

Inspected before the navigation work. Nothing below was discarded blindly.

## What already worked

| Capability | Where | Real or modelled |
| --- | --- | --- |
| Slope / hazard weighted A* | `src/services/pathSolver.js` | Real solver on an 800×600 tactical grid |
| Safe / Direct / Science modes | `generateDensePath(..., mode)` | Real cost function + science vias |
| Route metrics | `calculateRouteMetrics` | Derived from the solved polyline |
| Go / No-Go | `src/services/assess.js` | Seven checks from the live route |
| PLSS model | `src/services/plssCalculator.js` | NASA-style tanks, slope exertion, 45 min reserve |
| Procedural DEM / slope | `src/data/terrainElevationData.js` | Modelled Jezero / Gale / Coprates terrain |
| Missions, hab, waypoints | `src/data/missionsData.js` | Catalogued sites with canvas + lat/lon |
| Science POIs | `src/data/sciencePoisData.js` | Named targets with CRISM-style records |
| Elevation profile | `src/components/Charts.jsx` | Drawn from `path.points` |
| Hazard report loop | `MissionContext.reportHazard` | Simulated MC validation, real re-solve |
| Cesium Mars globe | `mars-atlas-src/` | Live NASA Trek imagery + MOLA/HRSC terrain |
| LMST clock | `src/hooks/useClock.js` | Real Mars Coordinated Time |

## What was simulated / demo-only

- Suit heart rate and “telemetry streaming” copy
- Mission Control validation delay (650–1700 ms)
- Earth signal delay badge (14.2 min)
- Spectral reflectance curves (representative, not raw CRISM cubes)
- Local elevation used by the solver (analytic DEM, not sampled live MOLA)

## What was disconnected

This was the product gap.

1. **No astronaut.** Telemetry was a 0–1 scrubber along a planned polyline. There was no lat/lon/heading that the rest of the UI treated as “you”.
2. **Routes did not start from the crew.** A* ran between stored waypoints, usually habitat → science → habitat, even if the tracker was mid-traverse.
3. **The map was an iframe with no shared state.** `MapCard` explicitly did not send route, crew, or hazards into Cesium.
4. **PLSS burned against planned duration × progress**, not distance walked or local slope while moving.
5. **Safe return was a circular radius** (`safeReturnRadiusKm`) estimated from endurance, not a routed walk-back.
6. **Charts were plan-centric.** The profile marker followed playback, not a free-moving crew.
7. **Default mission was Gale**, not Jezero, so the intended demo story did not open on the habitat.

## Reusable code (kept)

- `pathSolver.js` A*, line-of-sight smoothing, science vias, metrics
- `assess.js` Go / No-Go
- `plssCalculator.js` tank specs and slope exertion
- `terrainElevationData.js` elevation / slope / hazard polygons
- `coordinates.js` canvas ↔ aerocentric
- Planner, Science, Environment, Catalogue views
- Hazard log and EVA brief download
- Cesium atlas as the globe (not replaced)

## Technical debt left in place on purpose

- Canvas scale is 5.875 m/px in `coordinates.js` but slope uses 12.5 m/px inside the DEM helper. Changing that would retune every route; it was not touched.
- Tactical grid is local (~4.7 × 3.5 km). Clicks outside that box are rejected.
- Analytic DEM will not match live MOLA under the globe. The globe is for orientation; the solver uses the tactical model.

## Safest implementation path (taken)

Keep Cesium. Add astronaut state. Snapshot a route origin when the user picks a destination. Drive charts, HUD, PLSS, and the globe from that one crew pose. Do not introduce LithoSphere as a second engine.
