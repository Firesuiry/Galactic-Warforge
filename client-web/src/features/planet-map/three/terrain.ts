import * as THREE from 'three';
import type { FogMapView, PlanetOverviewView, PlanetSceneView } from '@shared/types';
import { getFogState, type PlanetRenderView } from '../model';

export type PlanetSurface = THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
export interface PlanetSurfaceData {
  planet: PlanetRenderView;
  overview?: PlanetOverviewView;
  fog?: FogMapView | PlanetSceneView;
}

// These are surface finishes, not generated terrain. Every biome and fog bit
// comes from the player's server view. Unknown cells have no biome data at all.
const FINISHES: Record<string, [string, number, number]> = {
  buildable: ['#455f51', 0, 0.15], plains: ['#455f51', 0, 0.15],
  plain: ['#455f51', 0, 0.15], grass: ['#3e6150', 0, 0.1], grassland: ['#3e6150', 0, 0.1],
  forest: ['#3c624d', 0, 0.2], blocked: ['#89867c', 0, 1],
  rock: ['#89867c', 0, 1], mountain: ['#89867c', 0, 1], mountains: ['#89867c', 0, 1],
  water: ['#125d63', 1, 0], sea: ['#125d63', 1, 0], ocean: ['#125d63', 1, 0],
  desert: ['#b3a080', 0, 0.3], sand: ['#b3a080', 0, 0.2],
  ice: ['#abc6cd', 0.5, 0.3], snow: ['#c5d3cf', 0, 0.3],
  swamp: ['#4e6656', 0.45, 0.1], lava: ['#8b4938', 0, 1],
};
const UNKNOWN_COLOR = new THREE.Color('#354655');
const COLORS = Object.fromEntries(Object.entries(FINISHES).map(([key, value]) => [key, new THREE.Color(value[0])]));
interface Atlas { color: THREE.DataTexture; properties: THREE.DataTexture }
interface SurfaceState {
  overview: Atlas;
  local: Atlas;
  uniforms: {
    swOverviewColor: { value: THREE.DataTexture };
    swOverviewProperties: { value: THREE.DataTexture };
    swLocalColor: { value: THREE.DataTexture };
    swLocalProperties: { value: THREE.DataTexture };
    swLocalBounds: { value: THREE.Vector4 };
    swLocalDimensions: { value: THREE.Vector2 };
    swOverviewExtent: { value: THREE.Vector2 };
  };
  source?: unknown[];
}
const states = new WeakMap<PlanetSurface, SurfaceState>();

function dataTexture(bytes: Uint8Array, width: number, height: number) {
  const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
  // Linear values are baked below; data texture rows start at the north pole.
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function atlas(width: number, height: number, sample: (x: number, y: number) => { terrain: string; explored: boolean; visible: boolean }): Atlas {
  const colors = new Uint8Array(width * height * 4);
  const properties = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = sample(x, y);
      const known = cell.explored && cell.terrain !== 'unknown';
      const finish = known ? FINISHES[cell.terrain] ?? FINISHES.buildable : undefined;
      const color = known ? COLORS[cell.terrain] ?? COLORS.buildable : UNKNOWN_COLOR;
      const i = (y * width + x) * 4;
      colors[i] = Math.round(color.r * 255);
      colors[i + 1] = Math.round(color.g * 255);
      colors[i + 2] = Math.round(color.b * 255);
      colors[i + 3] = 255;
      properties[i] = Math.round((finish?.[1] ?? 0) * 255);
      properties[i + 1] = Math.round((finish?.[2] ?? 0) * 255);
      properties[i + 2] = known ? 255 : 0;
      properties[i + 3] = known && cell.visible ? 255 : 0;
    }
  }
  return { color: dataTexture(colors, width, height), properties: dataTexture(properties, width, height) };
}

const SHADER_HEADER = /* glsl */`
  varying vec3 swSurfacePosition;
  uniform sampler2D swOverviewColor;
  uniform sampler2D swOverviewProperties;
  uniform sampler2D swLocalColor;
  uniform sampler2D swLocalProperties;
  uniform vec4 swLocalBounds;
  uniform vec2 swLocalDimensions;
  uniform vec2 swOverviewExtent;
  float swHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.17, 0.43, 0.71));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float swNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(swHash(i), swHash(i + vec3(1,0,0)), f.x),
      mix(swHash(i + vec3(0,1,0)), swHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(swHash(i + vec3(0,0,1)), swHash(i + vec3(1,0,1)), f.x),
      mix(swHash(i + vec3(0,1,1)), swHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float swFbm(vec3 p) {
    return swNoise(p) * 0.55 + swNoise(p * 2.03 + 13.7) * 0.27 + swNoise(p * 4.13 + 31.1) * 0.12 + swNoise(p * 8.31) * 0.06;
  }
`;

const SHADER_COLOR = /* glsl */`
  vec3 swP = normalize(swSurfacePosition);
  vec2 swUV = vec2(fract(atan(swP.z, -swP.x) / 6.28318530718 + 1.0), (1.0 - swP.y) * 0.5);
  vec2 swOverviewUV = swUV * swOverviewExtent;
  vec4 swProps = texture2D(swOverviewProperties, swOverviewUV);
  vec3 swAlbedo = texture2D(swOverviewColor, swOverviewUV).rgb;
  vec2 swLocalUV = (swUV - swLocalBounds.xy) / swLocalBounds.zw;
  if (all(greaterThanEqual(swLocalUV, vec2(0))) && all(lessThanEqual(swLocalUV, vec2(1)))) {
    vec4 swLocalProps = texture2D(swLocalProperties, swLocalUV);
    vec3 swLocalAlbedo = texture2D(swLocalColor, swLocalUV).rgb;
    // A scene window is a streaming boundary, not a visible cut in the planet.
    // Fade within the final half-cell only, without reading outside the view.
    vec2 swEdgeCells = min(swLocalUV, 1.0 - swLocalUV) * swLocalDimensions;
    float swEdgeX = swLocalBounds.z > 0.9999 ? 1.0 : smoothstep(0.0, 0.5, swEdgeCells.x);
    float swEdgeY = swLocalBounds.w > 0.9999 ? 1.0 : smoothstep(0.0, 0.5, swEdgeCells.y);
    float swLocalWeight = swEdgeX * swEdgeY;
    swProps = mix(swProps, swLocalProps, swLocalWeight);
    swAlbedo = mix(swAlbedo, swLocalAlbedo, swLocalWeight);
  }
  // A sphere pole is one point shared by every longitude. Do not stretch the
  // first row's unrelated visibility values into a bright triangular spike.
  float swMapHeight = swLocalDimensions.y / swLocalBounds.w;
  float swPolarBlend = smoothstep(0.0, 0.5, min(swUV.y, 1.0 - swUV.y) * swMapHeight);
  float swKnown = smoothstep(0.05, 0.95, swProps.b) * swPolarBlend;
  float swWater = smoothstep(0.15, 0.85, swProps.r);
  float swRock = swProps.g;
  float swContinental = swFbm(swP * 8.0);
  float swPixelFootprint = length(fwidth(swSurfacePosition));
  float swMicroDetail = 1.0 - smoothstep(0.09, 0.42, swPixelFootprint);
  float swGrain = mix(0.5, swFbm(swSurfacePosition * 2.4), swMicroDetail);
  float swFine = mix(0.5, swNoise(swSurfacePosition * 13.0), 1.0 - smoothstep(0.025, 0.12, swPixelFootprint));
  float swRidges = abs(swNoise(swSurfacePosition * 1.7 + swContinental) * 2.0 - 1.0);
  // Mineral stains and small soil variations remain continuous across tile edges.
  vec3 swSoilTint = mix(vec3(0.82, 0.91, 0.91), vec3(1.03, 1.03, 0.94), swContinental);
  swAlbedo *= mix(swSoilTint * (0.88 + swGrain * 0.16 + swFine * 0.08), vec3(0.95 + swContinental * 0.1), swWater);
  swAlbedo *= 1.0 - swRock * smoothstep(0.64, 0.95, swRidges) * 0.25;
  float swShore = (smoothstep(0.06, 0.28, swProps.r) - smoothstep(0.42, 0.8, swProps.r)) * swKnown;
  swAlbedo = mix(swAlbedo, vec3(0.23, 0.26, 0.18) * (0.85 + swGrain * 0.3), swShore * 0.5);
  // The uncharted hemisphere is a neutral scan veil, never fabricated land/water.
  vec3 swVeil = vec3(0.004, 0.011, 0.023) * (0.97 + swContinental * 0.06);
  swAlbedo = mix(swVeil, swAlbedo, swKnown);
  swAlbedo = mix(swAlbedo * vec3(0.71, 0.78, 0.86), swAlbedo, mix(0.4, 1.0, swProps.a));
  diffuseColor.rgb *= swAlbedo;
  float swHeight = mix((swGrain * 0.012 + swFine * 0.002 + swRidges * swRock * 0.012), swFine * 0.0004, swWater) * swKnown;
`;

export function createPlanetSurface(radius: number): PlanetSurface {
  const empty = () => atlas(1, 1, () => ({ terrain: 'unknown', explored: false, visible: false }));
  const overview = empty(), local = empty();
  const uniforms: SurfaceState['uniforms'] = {
    swOverviewColor: { value: overview.color }, swOverviewProperties: { value: overview.properties },
    swLocalColor: { value: local.color }, swLocalProperties: { value: local.properties },
    swLocalBounds: { value: new THREE.Vector4(0, 0, 1, 1) }, swLocalDimensions: { value: new THREE.Vector2(1, 1) }, swOverviewExtent: { value: new THREE.Vector2(1, 1) },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.91, metalness: 0.025 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 swSurfacePosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nswSurfacePosition = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + SHADER_HEADER)
      .replace('#include <map_fragment>', SHADER_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.94, mix(0.86 + swGrain * 0.1, 0.22, swWater), swKnown);')
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #include <normal_fragment_maps>
        vec3 swDx = dFdx(-vViewPosition), swDy = dFdy(-vViewPosition);
        vec3 swR1 = cross(swDy, normal), swR2 = cross(normal, swDx);
        float swDet = dot(swDx, swR1);
        vec3 swGradient = sign(swDet) * (dFdx(swHeight) * swR1 + dFdy(swHeight) * swR2);
        normal = normalize(abs(swDet) * normal - swGradient);
      `);
  };
  material.customProgramCacheKey = () => 'siliconworld-planet-surface-v1';
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 192, 128), material);
  mesh.receiveShadow = true;
  mesh.name = 'player-visible-planet-surface';
  states.set(mesh, { overview, local, uniforms });
  return mesh;
}

export function updatePlanetSurface(mesh: PlanetSurface, { planet, overview, fog }: PlanetSurfaceData) {
  const state = states.get(mesh);
  if (!state || planet.map_width < 1 || planet.map_height < 1) return;
  const bounds = 'bounds' in planet ? planet.bounds : { x: 0, y: 0, width: planet.map_width, height: planet.map_height };
  const effectiveFog = fog ?? ('bounds' in planet ? planet : undefined);
  const source = [planet.terrain, planet.map_width, planet.map_height, bounds.x, bounds.y, effectiveFog?.explored, effectiveFog?.visible,
    overview?.terrain, overview?.explored, overview?.visible, overview?.step];
  if (state.source?.every((value, i) => value === source[i])) return;
  state.source = source;
  const unknown = { terrain: 'unknown', explored: false, visible: false };
  const overviewWidth = Math.max(1, overview?.cells_width ?? 1);
  const overviewHeight = Math.max(1, overview?.cells_height ?? 1);
  const globalAtlas = atlas(overviewWidth, overviewHeight, (x, y) => overview ? {
    terrain: overview.terrain?.[y]?.[x] ?? 'unknown',
    explored: Boolean(overview.explored?.[y]?.[x]), visible: Boolean(overview.visible?.[y]?.[x]),
  } : unknown);
  const localWidth = Math.max(1, planet.terrain?.[0]?.length ?? 1);
  const localHeight = Math.max(1, planet.terrain?.length ?? 1);
  const localAtlas = atlas(localWidth, localHeight, (x, y) => {
    const terrain = planet.terrain?.[y]?.[x] ?? 'unknown';
    const visibility = effectiveFog ? getFogState(effectiveFog, bounds.x + x, bounds.y + y) : { explored: terrain !== 'unknown', visible: terrain !== 'unknown' };
    return { terrain, ...visibility };
  });
  if (overview && overviewWidth * overview.step === planet.map_width) {
    globalAtlas.color.wrapS = globalAtlas.properties.wrapS = THREE.RepeatWrapping;
  }
  if (localWidth === planet.map_width) {
    localAtlas.color.wrapS = localAtlas.properties.wrapS = THREE.RepeatWrapping;
  }
  for (const previous of [state.overview, state.local]) { previous.color.dispose(); previous.properties.dispose(); }
  state.overview = globalAtlas;
  state.local = localAtlas;
  state.uniforms.swOverviewColor.value = globalAtlas.color;
  state.uniforms.swOverviewProperties.value = globalAtlas.properties;
  state.uniforms.swLocalColor.value = localAtlas.color;
  state.uniforms.swLocalProperties.value = localAtlas.properties;
  state.uniforms.swLocalBounds.value.set(bounds.x / planet.map_width, bounds.y / planet.map_height, localWidth / planet.map_width, localHeight / planet.map_height);
  state.uniforms.swLocalDimensions.value.set(localWidth, localHeight);
  state.uniforms.swOverviewExtent.value.set(overview ? planet.map_width / (overviewWidth * overview.step) : 1, overview ? planet.map_height / (overviewHeight * overview.step) : 1);
}

export function disposePlanetSurface(mesh: PlanetSurface) {
  const state = states.get(mesh);
  if (state) {
    for (const value of [state.overview, state.local]) { value.color.dispose(); value.properties.dispose(); }
    states.delete(mesh);
  }
  mesh.geometry.dispose();
  mesh.material.dispose();
}
