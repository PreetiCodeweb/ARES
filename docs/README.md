# ARES documentation

Read these in order. They describe the Autonomous EVA Routing & Environmental Safety System after the mission-backend upgrade.

| Doc | What it covers |
| --- | --- |
| [01-system-audit.md](./01-system-audit.md) | What the frontend already solved, and what the API now owns |
| [02-architecture.md](./02-architecture.md) | Frontend modules, FastAPI engine, map adapter |
| [03-navigation-loop.md](./03-navigation-loop.md) | Closed loop: pose → A* → analysis → HUD → return |
| [04-setup.md](./04-setup.md) | Local run, env vars, demo story |
| [05-operations.md](./05-operations.md) | Solvers, ticks, Cesium messages, API calls |
| [06-backend.md](./06-backend.md) | REST contract, risk weights, GO / CAUTION / NO-GO |

ARES is a Vite + Preact frontend plus a FastAPI decision engine with SQLite. The globe still needs NASA Mars Trek. Routing, movement, and PLSS remain in the browser so a backend outage does not freeze the demo.

Planning data is modelled and simulated for design review. Not for flight.
