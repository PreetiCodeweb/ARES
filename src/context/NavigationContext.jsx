import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useMission } from './MissionContext.jsx';
import { canvasToMarsCoords, marsToCanvasCoords } from '../services/coordinates.js';
import { assessRoute } from '../services/assess.js';
import { fullTanks, tickPlss } from '../services/plssCalculator.js';
import { toast } from '../lib/toast.js';
import { headingBetween, headingLabel } from '../navigation/heading.js';
import { advanceAlongPath, BASE_WALK_MPS, nearestIndex, pointAtDistance, sampleTerrain, snapToPath, speedFactor, walkStep } from '../navigation/movementEngine.js';
import { nextInstruction, terrainAhead } from '../analysis/routeAnalysis.js';
import { compareNavRoutes, evaluateSafeReturn, generateReturnRoute, reachableEnvelope } from '../routing/returnRoute.js';
import { generatePlanetRoute, isPlanetaryDest } from '../routing/planetRoute.js';
function fmtGeo(lat, lon) {
  return {
    lat,
    lon,
    latStr: `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`,
    lonStr: `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`
  };
}

const Ctx = createContext(null);

function poseFrom(mission, missionId, x, y, heading, hazards) {
  const sampled = sampleTerrain(missionId, x, y, hazards);
  const geo = canvasToMarsCoords(mission, x, y);
  return { x, y, heading, status: 'nominal', speedMps: 0, ...sampled, ...geo };
}

export function NavigationProvider({ children }) {
  const m = useMission();
  const { mission, missionId, path, metrics, routeMode, hazards, pois } = m;
  const routing = m.routing || (hazards || []).filter((h) => h.validated);

  const [astronaut, setAstronaut] = useState(() => poseFrom(mission, missionId, mission.habSite.x, mission.habSite.y, 42, []));
  const [destination, setDestinationState] = useState(null);
  const [routeOrigin, setRouteOrigin] = useState(null);
  const [cameraMode, setCameraMode] = useState('orbit');
  const [controlMode, setControlMode] = useState('observe');
  const [clickIntent, setClickIntent] = useState('destination');
  const [following, setFollowing] = useState(false);
  const [followSpeed, setFollowSpeed] = useState(5);
  const [alongPx, setAlongPx] = useState(0);
  const [traveledM, setTraveledM] = useState(0);
  const [elapsedMin, setElapsedMin] = useState(0);
  const [locatePulse, setLocatePulse] = useState(0);
  const [stick, setStick] = useState({ forward: 0, turn: 0 });
  const [tanks, setTanks] = useState(() => fullTanks());
  const [envelope, setEnvelope] = useState([]);
  const [routeFitPulse, setRouteFitPulse] = useState(0);
  const keys = useRef({ f: 0, t: 0 });
  const lastReturnAt = useRef(0);
  const live = useRef({});

  const home = useMemo(() => {
    const h = mission.habSite;
    const geo = canvasToMarsCoords(mission, h.x, h.y);
    return { ...h, ...geo };
  }, [mission]);

  useEffect(() => {
    setAstronaut(poseFrom(mission, missionId, mission.habSite.x, mission.habSite.y, 42, []));
    setDestinationState(null);
    setRouteOrigin(null);
    setFollowing(false);
    setAlongPx(0);
    setTraveledM(0);
    setElapsedMin(0);
    setTanks(fullTanks());
    setEnvelope([]);
    setControlMode('observe');
    setCameraMode('orbit');
    setLocatePulse((n) => n + 1);
  }, [missionId]);

  const originGeo = useMemo(() => {
    if (!routeOrigin) return null;
    if (routeOrigin.lat != null && routeOrigin.lon != null) return routeOrigin;
    return { ...routeOrigin, ...canvasToMarsCoords(mission, routeOrigin.x, routeOrigin.y) };
  }, [routeOrigin, mission]);

  const comparisons = useMemo(() => {
    if (!destination || !routeOrigin) return null;
    const from = { ...originGeo, lat: originGeo.lat ?? astronaut.lat, lon: originGeo.lon ?? astronaut.lon, elevation: astronaut.elevation };
    const destGeo = {
      ...destination,
      lat: destination.lat ?? canvasToMarsCoords(mission, destination.x, destination.y).lat,
      lon: destination.lon ?? canvasToMarsCoords(mission, destination.x, destination.y).lon
    };
    if (isPlanetaryDest(from, destGeo)) {
      return {
        safe: generatePlanetRoute(from, destGeo, 'safe', from.elevation),
        direct: generatePlanetRoute(from, destGeo, 'direct', from.elevation),
        science: generatePlanetRoute(from, destGeo, 'science', from.elevation)
      };
    }
    return compareNavRoutes(routeOrigin, destination, missionId, routing);
  }, [destination, routeOrigin, missionId, routing, originGeo, mission]);

  const routed = destination && comparisons ? comparisons[routeMode] : null;
  const activePoints = routed?.points?.length ? routed.points : (path?.points || []);
  const activeMetrics = routed?.metrics || metrics;
  const rawStations = routed?.stations?.length ? routed.stations : (path?.stations || []);
  const activeStations = useMemo(() => rawStations.map((s, i) => {
    const wp = s.wp || s;
    const p = activePoints[s.index] || {};
    return {
      ...wp,
      n: i,
      t: p.t || 0,
      km: (activeMetrics.distanceKm || 0) * (p.t || 0),
      etaMin: Math.round((activeMetrics.estimatedTimeMin || 0) * (p.t || 0)),
      slope: p.slope || 0,
      elevation: p.elevation || 0
    };
  }), [rawStations, activePoints, activeMetrics]);

  const idx = useMemo(() => nearestIndex(activePoints, astronaut.x, astronaut.y), [activePoints, astronaut.x, astronaut.y]);
  const progress = activePoints.length ? Math.min(1, (alongPx / (activePoints[activePoints.length - 1].d || 1))) : 0;
  const alongPoint = activePoints[idx] || null;

  const geoAstro = useMemo(() => {
    if (routed?.planetary && astronaut.lat != null && astronaut.lon != null) {
      return { ...astronaut, ...fmtGeo(astronaut.lat, astronaut.lon) };
    }
    return { ...astronaut, ...canvasToMarsCoords(mission, astronaut.x, astronaut.y) };
  }, [astronaut, mission, routed]);

  const instruction = useMemo(
    () => nextInstruction(activePoints, idx, geoAstro.heading),
    [activePoints, idx, geoAstro.heading]
  );
  const ahead = useMemo(() => terrainAhead(activePoints, idx), [activePoints, idx]);

  const tanksSnap = useMemo(() => {
    const slope = geoAstro.slope || 0;
    return tickPlss(tanks, { dtMin: 0, slope, zone: geoAstro.zone, moving: following || Math.abs(keys.current.f) > 0 });
  }, [tanks, geoAstro.slope, geoAstro.zone, following]);

  const returnSnap = useRef({ from: null, path: { points: [], metrics: activeMetrics } });
  const returnRoute = useMemo(() => {
    const key = `${missionId}:${Math.round(geoAstro.x / 8)}:${Math.round(geoAstro.y / 8)}:${routing?.length || 0}`;
    if (returnSnap.current.from === key) return returnSnap.current.path;
    const pathR = generateReturnRoute(geoAstro, home, missionId, routing);
    returnSnap.current = { from: key, path: pathR };
    return pathR;
  }, [geoAstro.x, geoAstro.y, home, missionId, routing]);

  const safeReturn = useMemo(() => evaluateSafeReturn(tanksSnap, returnRoute.metrics), [tanksSnap, returnRoute]);
  const plss = useMemo(() => ({
    ...tanksSnap,
    isPointOfNoReturnExceeded: safeReturn.status === 'ponr',
    contingencyMet: safeReturn.status !== 'ponr'
  }), [tanksSnap, safeReturn.status]);

  const assessment = useMemo(
    () => assessRoute({ metrics: activeMetrics, points: activePoints, hazards, mission, endPlss: plss, pois }),
    [activeMetrics, activePoints, hazards, mission, plss, pois]
  );

  useEffect(() => {
    if (routed?.planetary) { setEnvelope([]); return; }
    const budget = safeReturn.budgetMeters;
    const key = `${Math.round(geoAstro.x / 16)}:${Math.round(geoAstro.y / 16)}:${Math.round(budget / 80)}:${routing?.length || 0}`;
    if (lastReturnAt.current === key) return;
    lastReturnAt.current = key;
    setEnvelope(reachableEnvelope(missionId, geoAstro, budget, routing));
  }, [geoAstro.x, geoAstro.y, safeReturn.budgetMeters, missionId, routing, routed?.planetary]);

  live.current = {
    mission, missionId, routing, astronaut, following, followSpeed, controlMode, stick,
    activePoints, alongPx
  };

  const applyPose = useCallback((next, movedM = 0) => {
    const geo = (next.lat != null && next.lon != null)
      ? fmtGeo(next.lat, next.lon)
      : canvasToMarsCoords(mission, next.x, next.y);
    setAstronaut((prev) => ({ ...prev, ...next, ...geo }));
    if (movedM > 0) setTraveledM((d) => d + movedM);
  }, [mission]);

  const burn = useCallback((dtMin, moving, slope, zone) => {
    setTanks((t) => tickPlss(t, { dtMin, slope, zone, moving }).tanks);
    setElapsedMin((e) => e + dtMin);
  }, []);

  useEffect(() => {
    const down = (e) => {
      if (controlMode !== 'walk') return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
      const k = e.key.toLowerCase();
      if (['w', 'arrowup'].includes(k)) { keys.current.f = 1; e.preventDefault(); }
      if (['s', 'arrowdown'].includes(k)) { keys.current.f = -0.55; e.preventDefault(); }
      if (['a', 'arrowleft'].includes(k)) { keys.current.t = -1; e.preventDefault(); }
      if (['d', 'arrowright'].includes(k)) { keys.current.t = 1; e.preventDefault(); }
    };
    const up = (e) => {
      const k = e.key.toLowerCase();
      if (['w', 'arrowup', 's', 'arrowdown'].includes(k)) keys.current.f = 0;
      if (['a', 'arrowleft', 'd', 'arrowright'].includes(k)) keys.current.t = 0;
    };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); };
  }, [controlMode]);

  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      const L = live.current;
      if (!L.astronaut) return;

      if (L.following && L.activePoints.length > 1) {
        const factor = speedFactor(sampleTerrain(L.missionId, L.astronaut.x, L.astronaut.y, L.routing));
        const meters = BASE_WALK_MPS * factor * L.followSpeed * dt;
        const stepped = advanceAlongPath(L.activePoints, L.alongPx, meters, L.missionId, L.routing);
        if (stepped) {
          applyPose(stepped.pose, meters);
          setAlongPx(stepped.alongPx);
          burn((dt / 60) * L.followSpeed, true, stepped.pose.slope, stepped.pose.zone);
          if (stepped.progress >= 0.999) {
            setFollowing(false);
            toast('Arrived. Check safe return before the next leg.', 'ok');
          }
        }
        return;
      }

      const forward = L.stick.forward || keys.current.f;
      const turn = L.stick.turn || keys.current.t;
      if (L.controlMode === 'walk' && (forward || turn)) {
        const next = walkStep(L.astronaut, { forward, turn, dt, missionId: L.missionId, hazards: L.routing });
        applyPose(next, next.movedM);
        setAlongPx(snapToPath(L.activePoints, next.x, next.y).alongPx);
        burn(dt / 60, next.movedM > 0.01, next.slope, next.zone);
        return;
      }

      burn((dt / 60) * 0.35, false, L.astronaut.slope, L.astronaut.zone);
    }, 100);
    return () => clearInterval(id);
  }, [applyPose, burn]);

  const locateAstronaut = () => setLocatePulse((n) => n + 1);

  const relocateTo = (x, y, heading) => {
    const pose = poseFrom(mission, missionId, x, y, heading ?? astronaut.heading, routing);
    applyPose(pose, 0);
    setAlongPx(snapToPath(activePoints, x, y).alongPx);
    setFollowing(false);
  };

  const setDestination = (dest) => {
    if (!dest) {
      setDestinationState(null);
      setRouteOrigin(null);
      return;
    }
    const canvas = dest.mapPos || (dest.x != null ? dest : null);
    const geo = dest.lat != null
      ? { lat: dest.lat, lon: dest.lon }
      : canvas
        ? canvasToMarsCoords(mission, canvas.x, canvas.y)
        : null;
    const point = {
      id: dest.id || `place-${Date.now()}`,
      name: dest.name || 'Map pin',
      type: dest.type || dest.category || 'place',
      category: dest.category,
      diameter: dest.diameter,
      planetary: !!dest.planetary || dest.lat != null,
      x: canvas?.x ?? astronaut.x,
      y: canvas?.y ?? astronaut.y,
      ...geo
    };
    setRouteOrigin({ x: astronaut.x, y: astronaut.y, lat: astronaut.lat, lon: astronaut.lon });
    setDestinationState(point);
    setControlMode('navigate');
    setAlongPx(0);
    setFollowing(false);
    setRouteFitPulse((n) => n + 1);
    toast(`Routing from your position to ${point.name}`, 'ok');
  };

  const returnToBase = () => {
    if (Math.hypot(astronaut.x - home.x, astronaut.y - home.y) < 18) {
      toast('Already at the habitat', 'info');
      return;
    }
    setDestination({ id: 'home', name: home.name, type: 'hab', x: home.x, y: home.y });
    m.setRouteMode('safe');
    toast('Safe return route computed from your position', 'ok');
  };

  const handlePlaceSelect = (place) => {
    if (!place || place.lat == null) return;
    setDestination({
      id: place.id || place.name,
      name: place.name,
      type: 'place',
      category: place.category,
      diameter: place.diameter,
      planetary: true,
      lat: place.lat,
      lon: place.lon
    });
  };

  const handleMapClick = (lat, lon, extra = {}) => {
    const { x, y } = marsToCanvasCoords(mission, lat, lon);
    const inTactical = x >= 0 && y >= 0 && x <= 800 && y <= 600;
    if (clickIntent === 'relocate') {
      if (!inTactical) {
        toast('Crew relocate stays inside this site’s tactical box. Use a nearby pin.', 'warn');
        return;
      }
      relocateTo(x, y);
      toast('Crew relocated to map pin', 'info');
      return;
    }
    if (extra.name || !inTactical) {
      handlePlaceSelect({ lat, lon, name: extra.name || 'Map pin', category: extra.category, id: extra.id, diameter: extra.diameter, planetary: !inTactical });
      return;
    }
    setDestination({ id: `pin-${Date.now()}`, name: extra.name || 'Map pin', type: 'waypoint', x, y, lat, lon });
  };

  const beginTraverse = () => {
    if (activePoints.length < 2) return toast('Choose a destination first', 'warn');
    const start = activePoints[0];
    const next = activePoints[1];
    if (routed?.planetary) {
      applyPose({
        ...astronaut,
        x: start.x,
        y: start.y,
        lat: start.lat,
        lon: start.lon,
        heading: next ? headingBetween(start.x, start.y, next.x, next.y) : astronaut.heading,
        elevation: start.elevation,
        slope: start.slope || 0
      }, 0);
      if (activeMetrics.distanceKm > 12) toast('Preview only: this destination is beyond suited EVA range.', 'warn');
    } else {
      relocateTo(start.x, start.y, headingBetween(start.x, start.y, next.x, next.y));
    }
    setAlongPx(0);
    setControlMode('navigate');
    setFollowing(true);
  };

  const seekProgress = (p) => {
    if (!activePoints.length) return;
    const max = activePoints[activePoints.length - 1].d || 1;
    const pt = pointAtDistance(activePoints, Math.max(0, Math.min(1, p)) * max);
    if (!pt) return;
    const pose = poseFrom(mission, missionId, pt.x, pt.y, pt.heading, routing);
    applyPose(pose, 0);
    setAlongPx(pt.d);
    setFollowing(false);
  };

  const resetCrew = () => {
    relocateTo(home.x, home.y, 42);
    setDestinationState(null);
    setRouteOrigin(null);
    setTanks(fullTanks());
    setTraveledM(0);
    setElapsedMin(0);
    setFollowing(false);
    setAlongPx(0);
  };

  const toggleFollow = () => {
    if (!activePoints.length) return;
    if (progress >= 1) {
      relocateTo(activePoints[0].x, activePoints[0].y);
      setAlongPx(0);
    }
    if (!following) toast('EVA under way. Consumables now track terrain effort.', 'info');
    setFollowing((p) => !p);
  };

  const value = {
    astronaut: geoAstro,
    home,
    destination,
    routeOrigin,
    cameraMode, setCameraMode,
    controlMode, setControlMode,
    clickIntent, setClickIntent,
    following, setFollowing, toggleFollow, beginTraverse,
    followSpeed, setFollowSpeed,
    alongPx, progress, idx, alongPoint,
    traveledM, traveledKm: traveledM / 1000, elapsedMin,
    locatePulse, locateAstronaut, routeFitPulse,
    points: activePoints, stations: activeStations, metrics: activeMetrics,
    comparisons, instruction, ahead, plss, assessment,
    returnRoute, safeReturn, envelope,
    headingText: headingLabel(geoAstro.heading),
    stick, setStick,
    setDestination, returnToBase, relocateTo, handleMapClick, handlePlaceSelect, resetCrew, seekProgress,
    routeAlerts: routed?.alerts || [],
    planetary: !!routed?.planetary,
    remainingKm: instruction.remainingKm,
    etaMin: Math.max(0, Math.round(activeMetrics.estimatedTimeMin * (1 - progress)))
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useNavigation = () => useContext(Ctx);
