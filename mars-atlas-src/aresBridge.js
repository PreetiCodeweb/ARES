import * as Cesium from 'cesium';
import { flyTo, MARS } from './globe.js';
import { publishNav, readNav, subscribeNav } from './navSync.js';

const CHANNEL = 'ares';
const embedded = window.parent && window.parent !== window;

function send(type, payload) {
  if (!embedded) return;
  window.parent.postMessage({ channel: CHANNEL, type, payload }, '*');
}

function hazardMeta(p) {
  if (!p?.hazardName) return null;
  const hot = !!(p.hazard || p.isHazard || p.band === 'hazard');
  const kind = p.hazardCategory === 'canyon' ? 'canyon wall / chasma'
    : p.hazardCategory === 'volcano' ? 'volcanic escarpment'
    : p.hazardCategory === 'chaos' ? 'collapsed chaos terrain'
    : 'mapped hazard terrain';
  return {
    name: p.hazardName,
    category: p.hazardCategory,
    lat: p.lat,
    lon: p.lon,
    level: hot ? 'fail' : 'warn',
    label: hot ? `Hazard: ${p.hazardName}` : `Caution: ${p.hazardName}`,
    detail: hot
      ? `Route transits ${kind} at ${p.hazardName}. Slow the traverse, check slope, and keep a return margin.`
      : `${p.hazardName} lies near this traverse. Expect rough terrain.`
  };
}

function degrees(p) {
  return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.height || 8);
}

/**
 * LithoSphere-style Walk / Observe / Home / Locate controls, adapted onto
 * the existing Cesium Mars globe. Standalone atlas visits ignore these messages.
 */
export function attachAresBridge({ viewer }) {
  if (embedded) document.documentElement.classList.add('ares-embedded');
  const dock = document.getElementById('dock');
  const ds = new Cesium.CustomDataSource('ares');
  const routeDs = new Cesium.CustomDataSource('ares-route');
  viewer.dataSources.add(ds);
  viewer.dataSources.add(routeDs);
  const closeDock = () => dock?.classList.remove('open');
  const H = 28000;
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#5a3228');

  const you = ds.entities.add({
    id: 'ares-you',
    name: 'YOU',
    position: degrees({ lat: 18.38, lon: 77.58, height: 12 }),
    point: {
      pixelSize: 14,
      color: Cesium.Color.fromCssColorString('#e4613a'),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: 'YOU',
      font: '700 11px Inter, sans-serif',
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#0d0a10').withAlpha(0.82),
      pixelOffset: new Cesium.Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });

  const headingLine = ds.entities.add({
    id: 'ares-heading',
    polyline: {
      positions: [],
      width: 3,
      material: Cesium.Color.fromCssColorString('#f4efe9'),
      clampToGround: false
    }
  });

  const dest = ds.entities.add({
    id: 'ares-dest',
    point: {
      pixelSize: 11,
      color: Cesium.Color.fromCssColorString('#7fc8cc'),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: 'DEST',
      font: '600 10px Inter, sans-serif',
      fillColor: Cesium.Color.fromCssColorString('#7fc8cc'),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#0d0a10').withAlpha(0.8),
      pixelOffset: new Cesium.Cartesian2(0, -20),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });

  const home = ds.entities.add({
    id: 'ares-home',
    point: {
      pixelSize: 12,
      color: Cesium.Color.fromCssColorString('#6fd6a3'),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: 'HAB',
      font: '700 10px Inter, sans-serif',
      fillColor: Cesium.Color.fromCssColorString('#6fd6a3'),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#0d0a10').withAlpha(0.8),
      pixelOffset: new Cesium.Cartesian2(0, -20),
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });

  const route = ds.entities.add({
    id: 'ares-route',
    polyline: { positions: [], width: 5, material: Cesium.Color.fromCssColorString('#e4613a'), clampToGround: false, arcType: Cesium.ArcType.GEODESIC }
  });
  const returnPath = ds.entities.add({
    id: 'ares-return',
    polyline: {
      positions: [],
      width: 2.4,
      material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString('#7fc8cc'), dashLength: 14 }),
      clampToGround: false,
      arcType: Cesium.ArcType.GEODESIC
    }
  });
  const envelope = ds.entities.add({
    id: 'ares-envelope',
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy([]),
      material: Cesium.Color.fromCssColorString('#6fd6a3').withAlpha(0.12),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString('#6fd6a3').withAlpha(0.45)
    }
  });

  const extras = [];
  let cameraMode = 'orbit';
  let lastYou = null;
  let lastRoute = [];
  let framed = false;
  let is2D = false;

  const BAND_COLOR = {
    safe: '#6fd6a3',
    caution: '#e8a53d',
    hazard: '#ff6b6b'
  };

  function linePositions(pts) {
    if (!pts?.length) return [];
    return pts.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, H));
  }

  function offset(lat, lon, heading, meters) {
    const rad = (heading * Math.PI) / 180;
    const dLat = (Math.cos(rad) * meters) / 111320;
    const dLon = (Math.sin(rad) * meters) / (111320 * Math.cos((lat * Math.PI) / 180));
    return { lat: lat + dLat, lon: lon + dLon };
  }

  function followCamera(youState) {
    if (cameraMode !== 'astronaut' || !youState) return;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 8;
    const destC = Cesium.Cartesian3.fromDegrees(youState.lon, youState.lat, (youState.elevation || 0) + 18);
    viewer.camera.setView({
      destination: destC,
      orientation: {
        heading: Cesium.Math.toRadians(youState.heading || 0),
        pitch: Cesium.Math.toRadians(-22),
        roll: 0
      }
    });
  }

  function applyYou(youState) {
    if (!youState) return;
    lastYou = youState;
    const pos = Cesium.Cartesian3.fromDegrees(youState.lon, youState.lat, 14);
    you.position = pos;
    const tip = offset(youState.lat, youState.lon, youState.heading || 0, 90);
    headingLine.polyline.positions = [
      Cesium.Cartesian3.fromDegrees(youState.lon, youState.lat),
      Cesium.Cartesian3.fromDegrees(tip.lon, tip.lat)
    ];
    followCamera(youState);
  }

  function addLine(pts, color, width, glow, meta) {
    if (!pts || pts.length < 2) return;
    const ent = routeDs.entities.add({
      polyline: {
        positions: linePositions(pts),
        width,
        material: glow
          ? new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.22, taperPower: 0.8, color: Cesium.Color.fromCssColorString(color) })
          : Cesium.Color.fromCssColorString(color),
        clampToGround: false,
        arcType: Cesium.ArcType.GEODESIC,
        depthFailMaterial: Cesium.Color.fromCssColorString(color).withAlpha(0.25)
      }
    });
    if (meta) ent.aresHazard = meta;
    return ent;
  }

  function paintRoute(pts) {
    routeDs.entities.removeAll();
    if (!pts?.length) {
      route.polyline.positions = [];
      return;
    }
    route.polyline.positions = linePositions(pts);
    route.polyline.clampToGround = false;
    route.show = true;
    addLine(pts, '#1a0c0a', 12, false);
    addLine(pts, '#e4613a', 6.5, true);
    let run = [pts[0]];
    let band = pts[0].band || (pts[0].hazard ? 'hazard' : 'safe');
    const flush = () => {
      if (run.length < 2) return;
      const meta = (band === 'hazard' || band === 'caution') ? hazardMeta(run.find((p) => p.hazardName) || run[0]) : null;
      addLine(run, BAND_COLOR[band] || BAND_COLOR.safe, band === 'hazard' ? 10 : 5.5, band === 'hazard', meta);
      if (meta) {
        const pick = routeDs.entities.add({
          polyline: {
            positions: linePositions(run),
            width: 22,
            material: Cesium.Color.fromCssColorString(BAND_COLOR[band] || '#ff6b6b').withAlpha(0.12),
            clampToGround: false,
            arcType: Cesium.ArcType.GEODESIC
          }
        });
        pick.aresHazard = meta;
      }
    };
    for (let i = 1; i < pts.length; i++) {
      const next = pts[i].band || (pts[i].hazard ? 'hazard' : 'safe');
      if (next !== band) {
        run.push(pts[i]);
        flush();
        run = [pts[i]];
        band = next;
      } else run.push(pts[i]);
    }
    flush();
  }

  function flyRoute(pts) {
    if (!pts?.length) return;
    if (embedded) closeDock();
    const a = pts[0], b = pts[pts.length - 1];
    let lon1 = a.lon, lon2 = b.lon;
    let dLonWrap = lon2 - lon1;
    while (dLonWrap > 180) { lon2 -= 360; dLonWrap -= 360; }
    while (dLonWrap < -180) { lon2 += 360; dLonWrap += 360; }
    const mid = { lat: (a.lat + b.lat) / 2, lon: ((lon1 + lon2) / 2 + 540) % 360 - 180 };
    const dLat = ((a.lat - b.lat) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const hav = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    const km = 2 * 3389.5 * Math.asin(Math.min(1, Math.sqrt(hav)));
    flyTo(viewer, mid.lat, mid.lon, Math.max(km * 0.72, is2D ? km * 0.9 : 90), 1.6);
  }

  function applyState(s) {
    if (!s) return;
    cameraMode = s.cameraMode || 'orbit';
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = cameraMode === 'astronaut' ? 8 : 1200;
    applyYou(s.astronaut);
    if (s.home) {
      home.position = Cesium.Cartesian3.fromDegrees(s.home.lon, s.home.lat, 12);
      home.show = true;
    }
    if (s.destination) {
      dest.position = Cesium.Cartesian3.fromDegrees(s.destination.lon, s.destination.lat, 12);
      dest.label.text = (s.destination.name || 'DEST').slice(0, 18);
      dest.show = true;
    } else dest.show = false;

    const prevKey = lastRoute.length ? `${lastRoute[0]?.lat},${lastRoute.at(-1)?.lat},${lastRoute.length}` : '';
    lastRoute = s.route || [];
    const retPts = linePositions(s.returnRoute || []);
    returnPath.polyline.positions = retPts;
    returnPath.polyline.clampToGround = false;
    returnPath.show = retPts.length > 1;
    const env = s.envelope || [];
    if (env.length > 3) {
      envelope.polygon.hierarchy = new Cesium.PolygonHierarchy(linePositions(env));
      envelope.show = true;
    } else envelope.show = false;

    extras.forEach((e) => ds.entities.remove(e));
    extras.length = 0;
    paintRoute(lastRoute);
    const labeled = new Set();
    lastRoute.forEach((p) => {
      if (!p.hazardName || labeled.has(p.hazardName)) return;
      if (!p.hazard && p.band === 'safe') return;
      labeled.add(p.hazardName);
      const hot = p.hazard || p.band === 'hazard';
      const meta = hazardMeta(p);
      const mark = routeDs.entities.add({
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, H + 400),
        ellipse: {
          semiMajorAxis: hot ? 160000 : 90000,
          semiMinorAxis: hot ? 160000 : 90000,
          material: Cesium.Color.fromCssColorString(hot ? '#ff6b6b' : '#e8a53d').withAlpha(0.22),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(hot ? '#ff6b6b' : '#e8a53d').withAlpha(0.85),
          height: H
        },
        point: {
          pixelSize: hot ? 18 : 14,
          color: Cesium.Color.fromCssColorString(hot ? '#ff6b6b' : '#e8a53d'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: `${hot ? '⚠ ' : ''}${p.hazardName}`,
          font: '700 12px Inter, sans-serif',
          fillColor: Cesium.Color.fromCssColorString(hot ? '#ffd0d0' : '#ffe3b0'),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString(hot ? '#2a1010' : '#24180a').withAlpha(0.88),
          pixelOffset: new Cesium.Cartesian2(0, -22),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
      mark.aresHazard = meta;
    });
    if (!s.planetary) {
      (s.hazards || []).forEach((h) => {
        extras.push(ds.entities.add({
          position: Cesium.Cartesian3.fromDegrees(h.lon, h.lat, H),
          ellipse: {
            semiMajorAxis: h.rMeters || 80,
            semiMinorAxis: h.rMeters || 80,
            material: Cesium.Color.fromCssColorString('#ff6b6b').withAlpha(0.28),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString('#ff6b6b')
          }
        }));
      });
      (s.pois || []).forEach((p) => {
        extras.push(ds.entities.add({
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, H),
          point: { pixelSize: 8, color: Cesium.Color.fromCssColorString('#7fc8cc'), outlineColor: Cesium.Color.WHITE, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: { text: p.name, font: '600 10px Inter, sans-serif', fillColor: Cesium.Color.fromCssColorString('#cfe9ea'), pixelOffset: new Cesium.Cartesian2(0, -16), disableDepthTestDistance: Number.POSITIVE_INFINITY, show: cameraMode === 'orbit' }
        }));
      });
    }

    const nextKey = lastRoute.length ? `${lastRoute[0]?.lat},${lastRoute.at(-1)?.lat},${lastRoute.length}` : '';
    if (lastRoute.length > 1 && nextKey !== prevKey) {
      framed = true;
      closeDock();
      flyRoute(lastRoute);
    } else if (!framed && s.astronaut) {
      framed = true;
      flyTo(viewer, s.astronaut.lat, s.astronaut.lon, 6, 2.4);
    }
  }

  let readyTick = null;
  if (embedded) readyTick = setInterval(() => send('ares:ready', {}), 400);

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.channel !== CHANNEL) return;
    if (data.type === 'ares:state') {
      if (readyTick) clearInterval(readyTick);
      applyState(data.payload);
    }
    if (data.type === 'ares:you') applyYou(data.payload);
    if (data.type === 'ares:locate' && lastYou) {
      if (cameraMode === 'astronaut') followCamera(lastYou);
      else flyTo(viewer, lastYou.lat, lastYou.lon, 4, 1.4);
    }
    if (data.type === 'ares:home' && lastYou) flyTo(viewer, lastYou.lat, lastYou.lon, 8, 1.6);
    if (data.type === 'ares:fit') flyRoute(lastRoute);
    if (data.type === 'ares:morph') {
      const want2D = !!data.payload?.flat;
      if (want2D !== is2D) {
        is2D = want2D;
        if (is2D) viewer.scene.morphTo2D(1.2);
        else viewer.scene.morphTo3D(1.2);
      }
      if (lastRoute.length > 1) setTimeout(() => flyRoute(lastRoute), 1300);
    }
  });

  function atlasToast(h) {
    document.querySelectorAll('.toast.toast-hazard').forEach((n) => n.remove());
    const el = document.createElement('div');
    el.className = 'toast toast-hazard';
    el.setAttribute('role', 'alert');
    el.innerHTML = `<strong>${h.label}</strong><span>${h.detail || ''}</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5200);
  }

  function showAtlasAlert(h) {
    const card = document.getElementById('ares-alert');
    if (card) {
      card.hidden = false;
      card.classList.toggle('fail', h.level === 'fail');
      const title = card.querySelector('.ares-alert-title');
      const body = card.querySelector('.ares-alert-body');
      if (title) title.textContent = h.label;
      if (body) body.textContent = h.detail || '';
    }
    atlasToast(h);
  }

  function raiseHazard(h) {
    if (!h) return true;
    showAtlasAlert(h);
    send('ares:hazard', h);
    return true;
  }

  window.__aresPick = (click) => {
    const picked = viewer.scene.pick(click.position);
    const ent = picked && (picked.id || picked.primitive?.id);
    if (ent?.aresHazard) return raiseHazard(ent.aresHazard);
    return false;
  };

  window.__aresClick = (click, cartesian) => {
    if (window.__aresPick(click)) return true;
    if (!cartesian || !embedded) return false;
    const carto = Cesium.Cartographic.fromCartesian(cartesian, MARS);
    send('ares:click', {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude)
    });
    return false;
  };

  window.__aresApplyRoute = (s, { publish = false } = {}) => {
    applyState(s);
    if (publish) publishNav(s);
  };

  subscribeNav((s) => {
    if (s?.route?.length) applyState(s);
  });
  const stored = readNav();
  if (stored?.route?.length) applyState(stored);

  document.getElementById('ares-alert-dismiss')?.addEventListener('click', () => {
    const card = document.getElementById('ares-alert');
    if (card) card.hidden = true;
  });

  if (embedded) {
    send('ares:ready', {});
  }
  return { embedded, ds };
}
