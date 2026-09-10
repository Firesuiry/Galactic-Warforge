import * as THREE from 'three';
import type { DysonLayerView, FleetRuntimeView, PlanetRef, SystemRuntimeView, SystemView } from '@shared/types';

export interface SystemThreeData {
  system: SystemView;
  runtime?: SystemRuntimeView;
  fleets?: FleetRuntimeView[];
}
export interface OrbitalPlanet {
  planet: PlanetRef;
  radius: number;
  orbitRadius: number;
  inclination: number;
  position: THREE.Vector3;
}

export function stablePhase(id: string) {
  let hash = 2166136261;
  for (const letter of id) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (((hash ^ (hash >>> 16)) >>> 0) / 4294967296) * Math.PI * 2;
}

/** Diagram scale, not a physical-distance simulation. Ordering always follows public AU. */
export function displayOrbitRadius(au: number) {
  return 7 + Math.sqrt(Math.max(0, Number.isFinite(au) ? au : 0)) * 10;
}

export function orbitPoint(radius: number, inclination: number, phase: number) {
  return new THREE.Vector3(Math.cos(phase) * radius, Math.sin(phase) * radius * Math.sin(inclination), Math.sin(phase) * radius * Math.cos(inclination));
}

/** Orbit phase is not exposed by the API: stable diagram placement never pretends to simulate it. */
export function layoutPlanets(system: SystemView): OrbitalPlanet[] {
  if (!system.discovered) return [];
  return (system.planets ?? []).filter(planet => planet.discovered).map((planet, index) => {
    const orbitRadius = planet.orbit ? displayOrbitRadius(planet.orbit.distance_au) : 12 + index * 6;
    const inclination = THREE.MathUtils.degToRad(planet.orbit?.inclination_deg ?? 0);
    const radius = /gas|giant/.test(planet.kind ?? '') ? 1.45 : /ice|frozen/.test(planet.kind ?? '') ? .85 : 1;
    return { planet, radius, orbitRadius, inclination, position: orbitPoint(orbitRadius, inclination, stablePhase(planet.planet_id)) };
  });
}

export function dysonPoint(radius: number, latitude: number, longitude: number) {
  const lat = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(latitude, -90, 90));
  const lon = THREE.MathUtils.degToRad(longitude);
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).multiplyScalar(radius);
}

/** Frames without both public endpoints cannot be positioned and must not be invented. */
export function resolvedDysonFrames(layer: DysonLayerView) {
  const nodes = new Map((layer.nodes ?? []).map(node => [node.id, node]));
  return (layer.frames ?? []).flatMap(frame => {
    const a = nodes.get(frame.node_a_id), b = nodes.get(frame.node_b_id);
    return a && b ? [{ frame, a, b }] : [];
  });
}

export function publicFleets(data: SystemThreeData): FleetRuntimeView[] {
  if (!data.system.discovered || (data.runtime && (!data.runtime.available || !data.runtime.discovered))) return [];
  return (data.fleets ?? data.runtime?.fleets ?? []).filter(fleet => fleet.system_id === data.system.system_id && !fleet.transit);
}

export function visibleDysonLayers(data: SystemThreeData) {
  return data.system.discovered && data.runtime?.discovered && data.runtime.available
    ? data.runtime.dyson_sphere?.layers ?? [] : [];
}
