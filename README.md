# ARES — Mars EVA traverse planner

```
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/ + pre-compressed .br/.gz files
npm run preview
```

The Mars Atlas map (`mars-atlas.html`, `mars-atlas-src/`) is the original, byte for byte. The React shell only embeds it.
NASA imagery and terrain still stream live from NASA Mars Trek, so the map needs internet.

## Front end layout
- `src/services/pathSolver.js` — slope / hazard weighted A* solver (Safe, Direct, Science max)
- `src/services/assess.js` — Go / No-Go engine, 7 checks derived from the live route
- `src/context/` — mission (route, hazards, persistence), telemetry (walk simulation), ui
- `src/components/`, `src/views/` — lazy-loaded views; the Explorer stays mounted so the map never reloads
- `src/styles/app.css` — design tokens (`@theme`) and the few shared component classes

## Hosting (keeps server load near zero)
- Serve `dist/` from any static host. `public/_headers` sets immutable caching for Netlify / Cloudflare Pages.
- nginx: enable `brotli_static on; gzip_static on;` to serve the pre-built `.br` / `.gz` files with no CPU cost.
- `public/sw.js` caches the app shell, so repeat visits and offline demos cost the server nothing.

Planning data is modelled and simulated for design review. Not for flight.
