# Project setup

## Requirements

- Node.js 18+
- npm
- A browser with WebGL
- Internet access for NASA Mars Trek imagery and marshub terrain

## Install and run

From the `Frontend` folder:

```bash
npm install
npm run dev
```

Vite serves the app at **http://localhost:5173/** (or the next free port).

| Script | Command | Result |
| --- | --- | --- |
| Dev | `npm run dev` | Vite on port 5173, `host: true` |
| Production build | `npm run build` | `dist/` plus precompressed `.br` / `.gz` |
| Preview build | `npm run preview` | Serve `dist/` locally |

`vite.config.js` has two HTML entries: `index.html` (ARES shell) and `mars-atlas.html` (globe). Both must stay in the build so the iframe works in production.

## Important URLs

| URL | What |
| --- | --- |
| `/` | ARES mission control + navigation |
| `/mars-atlas.html` | Globe standalone (full atlas chrome) |
| `/mars-atlas.html` in an iframe | Embedded mode: chrome hidden, ARES overlay on |

## Demo story (Jezero)

The default mission is Jezero Crater, habitat **Ares Base Alpha**.

1. Dismiss the briefing (Enter).
2. Confirm the header shows **Return nominal** and the HUD shows your lat/lon at the habitat.
3. Click **Locate astronaut** — the globe frames you.
4. Open **Science targets** and click **Navigate here** on Skinner Ridge (or click the globe).
5. Compare **Safest / Fastest / Science** on the explorer. Keep Safest.
6. Click **Begin EVA**. Marker, profile, terrain-ahead, O₂, and ETA should all move together.
7. Use **Report hazard** mid-walk. After validation the route re-solves from the last origin / current dest.
8. Watch **Safe return**. If margin drops, click **Return to base**.
9. Switch camera to **Astronaut** for a heading-up follow view. Use **Walk** + WASD for manual motion.

## Keyboard

| Key | Action |
| --- | --- |
| W / ↑ | Walk forward (Walk mode) |
| S / ↓ | Walk back |
| A / ← | Turn left |
| D / → | Turn right |
| Ctrl/Cmd K or `/` | Command palette |
| Enter / Esc | Skip first-run briefing |

Palette actions include Locate astronaut, Return to base, and Walk mode.
