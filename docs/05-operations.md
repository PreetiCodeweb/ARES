# Runtime operations

There is no server-side backend. These are the in-browser services that run while the app is open.

## 1. Mission plan (existing)

On waypoint, mode, or validated-hazard change:

```
waypoints + hazards + routeMode
        → generateDensePath()     A* per leg, then densify
        → calculateRouteMetrics()
        → calculatePlssConsumption(metrics, 1)   plan-end reserves
        → assessRoute()           Go / No-Go for the stored plan
```

Persisted in `localStorage` key `ares:v2` (mission, mode, waypoints, hazards).

## 2. Live navigation (new)

10 Hz tick in `NavigationProvider` (`document.hidden` pauses it):

```
if following:
    speed = 0.9 m/s × terrainFactor × followSpeed
    advance along active path
    tickPlss(moving=true)
else if walk + WASD/stick:
    walkStep()
    tickPlss(moving)
else:
    tickPlss(idle 0.42×)
```

After each pose update:

```
sample elevation/slope
project onto active path → progress, profile marker, instruction
throttle return A* (~8 px)
throttle reachable envelope (~16 px)
postMessage ares:you to Cesium
```

## 3. Destination solve

`setDestination(poi | map pin | habitat)` snapshots `routeOrigin = astronaut` then:

```
compareNavRoutes(origin, dest)
  safe    → A*
  direct  → straight
  science → A* + POI vias
UI picks routeMode
activePath = comparisons[routeMode]
charts / HUD / globe switch to that path
```

Clicks on the globe: iframe `ares:click` → `marsToCanvasCoords`. Outside 0..800, 0..600 is rejected.

## 4. Cesium bridge

Parent → globe

| type | when | payload |
| --- | --- | --- |
| `ares:state` | dest / route / hazards / camera / envelope | overlays |
| `ares:you` | 10 Hz pose | lat, lon, heading, elevation |
| `ares:locate` | Locate astronaut button | fly / follow |

Globe → parent

| type | when |
| --- | --- |
| `ares:ready` | bridge attached |
| `ares:click` | left click on terrain |

All messages use `{ channel: 'ares', type, payload }`.

## 5. Consumables

Tanks start full (`1200 L O₂`, `1800 Wh`, `4.8 L` feedwater).

`tickPlss` in `src/services/plssCalculator.js`:

- slope factor `1 + (max(slope,0)/10)^1.35 * 0.45`
- mapped zone × 1.18
- idle × 0.42
- battery +60 W above 8° slope

Point of no return is **routed**: remaining litres vs `(returnMinutes + 45) * burnRate`.

## 6. What looks like a backend (and is not)

The hazard log still shows report → validate → publish → replace. That is a client timeout sequence in `MissionContext.reportHazard`. The replacement path is a real A* re-solve on the same device.

## 7. Offline

Service worker (`public/sw.js`) caches the app shell in production. The globe needs the network. The tactical solver, HUD, charts, and EVA brief keep working offline.
