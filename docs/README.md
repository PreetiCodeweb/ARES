# ARES documentation

This folder describes the Adaptive Route Exploration System after the astronaut-navigation upgrade. Read these in order.

| Doc | What it covers |
| --- | --- |
| [01-system-audit.md](./01-system-audit.md) | What already worked, what was simulated, what was disconnected |
| [02-architecture.md](./02-architecture.md) | Source of truth, modules, map adapter, LithoSphere decision |
| [03-navigation-loop.md](./03-navigation-loop.md) | Closed loop from position → route → charts → PLSS → return |
| [04-setup.md](./04-setup.md) | Local setup, scripts, demo story |
| [05-operations.md](./05-operations.md) | Runtime operations: solvers, ticks, messages, caching |

The product is still a static Vite + Preact frontend. There is no separate backend process. “Backend” in these docs means the in-browser services that solve routes, sample terrain, burn life support, and talk to the Cesium globe.

Planning data is modelled and simulated for design review. Not for flight.
