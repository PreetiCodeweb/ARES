# Architecture

## Decision: LithoSphere Option B

LithoSphere (NASA AMMOS, Three.js, tile globe, Walk / Observe / Home / Compass / Coordinates) is the **navigation concept source**, not a second renderer.

ARES already ships Cesium with Mars ellipsoid, Trek WMTS, and marshub terrain. Adding Three.js would split cameras, picking, and demo reliability.

What was taken from LithoSphere:

- Walk / Observe / Navigate control modes
- Orbit vs astronaut (first-person) camera
- Home / Locate as first-class actions
- Always-on coordinates, heading, elevation
- Layered overlays (crew, route, return, envelope, science, hazards)

What stayed Cesium: globe, imagery, DEM, picking, geodesic polylines.

## Source of truth

```
MissionProvider          waypoints, hazards, routeMode, planned A* path
  NavigationProvider     astronaut, destination, live route, PLSS tanks, return
    TelemetryProvider    adapter so existing Tracker / Planner keep working
      UiProvider         view / role / palette
```

One crew pose drives:

- Cesium marker and heading tick
- GPS HUD
- elevation profile marker
- terrain-ahead strip
- PLSS meters
- safe-return status
- header badge

Routes are **not** rebuilt every animation frame. A* runs when destination, route mode, mission, or validated hazards change. The origin is a snapshot of the astronaut at that moment (`routeOrigin`).

## New modules

```
src/navigation/heading.js            compass math
src/navigation/movementEngine.js     slope-scaled walk + path interpolation
src/analysis/routeAnalysis.js        next instruction + terrain ahead
src/routing/returnRoute.js           walk-back A*, three-way compare, envelope
src/map/atlasBridge.js               parent postMessage helpers
src/context/NavigationContext.jsx    the closed loop
src/components/NavigationHUD.jsx     GPS panel, route compare, safe return
src/components/TerrainAhead.jsx      difficulty strip
mars-atlas-src/aresBridge.js         Cesium overlay + cameras
```

Existing files were extended, not rewritten: `pathSolver.js` (export `gridFor`), `plssCalculator.js` (`tickPlss`), `MapCard.jsx`, `Explorer.jsx`, `TelemetryContext.jsx`, `Charts.jsx`.

## Map adapter

The globe stays on `/mars-atlas.html`. When that page detects `window.parent !== window` it:

1. Adds `html.ares-embedded` and hides atlas chrome
2. Listens for `{ channel: 'ares', type, payload }`
3. Draws YOU / HAB / DEST / route / dashed return / green envelope / POIs / hazards
4. Posts clicks back as `ares:click { lat, lon }`

Standalone `/mars-atlas.html` is unchanged for full-screen use.
