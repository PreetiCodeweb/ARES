# Navigation loop

This is the product loop. Every panel reads the same astronaut state.

```
USER POSITION (lat, lon, heading, elevation)
        ↓
CURRENT TERRAIN (slope, zone, reported hazard)
        ↓
DESTINATION (POI, map click, or habitat)
        ↓
ROUTE SOLVER  (safe | direct | science) from routeOrigin → dest
        ↓
ROUTE GEOMETRY (tactical pixels, densified ~8 px)
        ↓
ANALYSIS
  elevation profile     ← active path + you marker
  terrain ahead         ← samples forward of idx
  next GPS instruction  ← heading + remaining km
        ↓
MOVEMENT
  Walk: WASD / stick, speed × slope/hazard factor
  Navigate: interpolate along the solved path
        ↓
PLSS tick  (O2, battery, feedwater × effort × dt)
        ↓
SAFE RETURN
  A* to habitat + 45 min reserve
  reachable envelope on the same grid
        ↓
MAP + HUD update
        ↓
updated USER POSITION
```

## Control modes

| Mode | Camera | Movement |
| --- | --- | --- |
| Observe | Orbit or astronaut | None. Map clicks set destination (or relocate crew). |
| Walk | Usually astronaut | W/S translate, A/D yaw. Speed 1.0× flat → 0.35× hazard. |
| Navigate | Either | Follows the solved polyline at EVA speed × playback. |

## Route strategies

All three still use `generateDensePath` so the original cost function is preserved.

1. **Safest (`safe`)** — A* with slope² penalty, 15° wall, mapped zones, reported hazards
2. **Fastest (`direct`)** — straight legs; severe hazards still show up in Go / No-Go
3. **Science (`science`)** — A* plus vias through nearby POIs (`withScienceVias`)

## PLSS

`tickPlss` burns tanks from **elapsed movement and local slope**, not `progress × planned minutes`.

```
O2 burn = nominalRate × (moving ? 1 : 0.42) × slopeFactor × terrainFactor × dtMin
```

Idle life support still drains slowly so a stopped crew is not frozen in time.

## Safe return

`generateReturnRoute` runs A* from the live pose to `mission.habSite` in safest mode.

`evaluateSafeReturn` compares remaining O₂ to (return time + 45 min) × current burn rate:

- `nominal` — SAFE RETURN: NOMINAL
- `low` — RETURN MARGIN LOW
- `ponr` — POINT OF NO RETURN

`reachableEnvelope` is a Dijkstra on the same 16 px grid with remaining walk budget. It is a hull of reachable cells, not a circle. Recomputed about every 16 px of motion.

## Performance rules

- 10 Hz simulation tick, paused when the tab is hidden
- A* only on dest / mode / hazard changes
- Return path keyed to ~8 px bins
- Envelope keyed to ~16 px bins + O₂ budget
- Cesium gets `ares:you` for pose and `ares:state` for overlays
- Explorer stays mounted so the iframe is not reloaded
