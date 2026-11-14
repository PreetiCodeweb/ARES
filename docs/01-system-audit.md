# System audit

Inspected before the navigation work and again before the mission-backend work. Nothing below was discarded blindly.

## What already worked (frontend)

| Capability | Where | Real or modelled |
| --- | --- | --- |
| Slope / hazard weighted A* | `src/services/pathSolver.js` | Real solver on an 800×600 tactical grid |
| Safe / Direct / Science modes | `generateDensePath(..., mode)` | Real cost function + science vias |
| Route metrics | `calculateRouteMetrics` | Derived from the solved polyline |
| Local Go / No-Go | `src/services/assess.js` | Seven checks from the live route |
| PLSS model | `src/services/plssCalculator.js` | NASA-style tanks, slope exertion, 45 min reserve |
| Procedural DEM / slope | `src/data/terrainElevationData.js` | Modelled Jezero / Gale / Coprates terrain |
| Missions, hab, waypoints | `src/data/missionsData.js` | Catalogued sites with canvas + lat/lon |
| Science POIs | `src/data/sciencePoisData.js` | Named targets with CRISM-style records |
| Cesium Mars globe | `mars-atlas-src/` | Live NASA Trek imagery + MOLA/HRSC terrain |
| LMST clock | `src/hooks/useClock.js` | Real Mars Coordinated Time |

## What the backend now owns

| Capability | Where |
| --- | --- |
| Mission persistence | `POST /api/missions` · SQLite `missions` |
| Risk scoring | `backend/app/services/risk_service.py` |
| GO / CAUTION / NO-GO | same module, with written reasons |
| Live telemetry log | `POST /api/telemetry/update` |
| Hazard intersect + reroute flag | `POST /api/navigation/hazard` |
| Route comparison | `POST /api/navigation/compare` |

The frontend A* solver is **not** replaced. It still generates the polyline. The engine evaluates that polyline.

## What remains simulated

- Suit heart rate
- Mission Control validation delay (650–1700 ms) before a hazard is marked `validated`
- Earth signal delay badge (14.2 min)
- Spectral reflectance curves (representative, not raw CRISM cubes)
- Local elevation used by the solver (analytic DEM, not sampled live MOLA)

## Reusable code (kept)

- `pathSolver.js`, `assess.js`, `plssCalculator.js`, `terrainElevationData.js`, `coordinates.js`
- Planner, Science, Environment, Catalogue views
- Hazard log and EVA brief
- Cesium atlas as the globe

## Implementation path (taken)

Keep Cesium. Keep A*. Add astronaut state. Snapshot a route origin when the user picks a destination. Post metrics to FastAPI. Show the engine verdict in the existing Go / No-Go card. If the API is down, the in-browser checks still run.
