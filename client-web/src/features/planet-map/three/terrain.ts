import * as THREE from 'three';
import { surfaceStep, type SurfaceDirection } from '@shared/surface';
import type { FogMapView, PlanetOverviewView, PlanetSceneView } from '@shared/types';
import { getFogState, getTerrainTile, type PlanetRenderView } from '../model';

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
interface SurfaceSample { terrain: string; explored: boolean; visible: boolean; coast?: number[] }
interface Atlas { color: THREE.DataTexture; properties: THREE.DataTexture; coast: THREE.DataTexture }
interface SurfaceState {
  overview: Atlas;
  local: Atlas;
  uniforms: {
    swOverviewColor: { value: THREE.DataTexture };
    swOverviewProperties: { value: THREE.DataTexture };
    swLocalColor: { value: THREE.DataTexture };
    swLocalProperties: { value: THREE.DataTexture };
    swOverviewCoast: { value: THREE.DataTexture };
    swLocalCoast: { value: THREE.DataTexture };
    swMapDimensions: { value: THREE.Vector2 };
    swLocalDimensions: { value: THREE.Vector2 };
    swOverviewDimensions: { value: THREE.Vector2 };
    swTime: { value: number };
    swPatchBounds: {value: THREE.Vector4[]};
    swPatchUV: {value: THREE.Vector4[]};
  };
  source?: unknown[];
}
const states = new WeakMap<PlanetSurface, SurfaceState>();

function dataTexture(bytes: Uint8Array, width: number, height: number) {
  const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
  // Linear values are baked below; data texture rows follow the six-face atlas.
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function atlas(width: number, height: number, sample: (x: number, y: number) => SurfaceSample): Atlas {
  const colors = new Uint8Array(width * height * 4);
  const properties = new Uint8Array(width * height * 4);
  const coast = new Uint8Array(width * height * 4);
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
      if (known && finish?.[1] === 1) coast.set(cell.coast ?? [0, 0, 0, 0], i);
    }
  }
  return { color: dataTexture(colors, width, height), properties: dataTexture(properties, width, height), coast: dataTexture(coast, width, height) };
}

/** Cardinal shore flags use real cube-sphere neighbors, including rotated face seams. */
function coastAt(x: number, y: number, faceSize: number, sample: (x: number, y: number) => SurfaceSample) {
  return (['north', 'east', 'south', 'west'] as SurfaceDirection[]).map(direction => {
    const { tile } = surfaceStep({ x, y }, direction, faceSize);
    const neighbor = sample(tile.x, tile.y);
    return neighbor.explored && neighbor.terrain !== 'unknown' && (FINISHES[neighbor.terrain]?.[1] ?? 0) === 0 ? 255 : 0;
  });
}

const SHADER_HEADER = /* glsl */`
  varying vec3 swSurfacePosition;
  uniform sampler2D swOverviewColor;
  uniform sampler2D swOverviewProperties;
  uniform sampler2D swLocalColor;
  uniform sampler2D swLocalProperties;
  uniform sampler2D swOverviewCoast;
  uniform sampler2D swLocalCoast;
  uniform vec2 swMapDimensions;
  uniform vec2 swLocalDimensions;
  uniform vec2 swOverviewDimensions;
  uniform float swTime;
  uniform vec4 swPatchBounds[7];
  uniform vec4 swPatchUV[7];
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
  vec3 swA = abs(swP);
  float swFace; vec2 swFaceUV;
  if (swA.z >= swA.x && swA.z >= swA.y) {
    swFace = swP.z >= 0.0 ? 0.0 : 2.0;
    swFaceUV = vec2(swP.z >= 0.0 ? swP.x : -swP.x, -swP.y) / swA.z;
  } else if (swA.x >= swA.y) {
    swFace = swP.x >= 0.0 ? 1.0 : 3.0;
    swFaceUV = vec2(swP.x >= 0.0 ? -swP.z : swP.z, -swP.y) / swA.x;
  } else {
    swFace = swP.y >= 0.0 ? 4.0 : 5.0;
    swFaceUV = vec2(swP.x, swP.y >= 0.0 ? swP.z : -swP.z) / swA.y;
  }
  swFaceUV = atan(swFaceUV) / 1.57079632679 + 0.5;
  vec2 swUV = (vec2(mod(swFace,3.0),floor(swFace/3.0)) + clamp(swFaceUV,0.000001,0.999999)) / vec2(3.0,2.0);
  vec2 swFaceOrigin = vec2(mod(swFace,3.0),floor(swFace/3.0)) / vec2(3.0,2.0);
  vec2 swOverviewHalfTexel = 0.5 / swOverviewDimensions;
  vec2 swOverviewUV = clamp(swUV, swFaceOrigin + swOverviewHalfTexel,
    swFaceOrigin + 1.0 / vec2(3.0,2.0) - swOverviewHalfTexel);
  vec4 swProps = texture2D(swOverviewProperties, swOverviewUV);
  vec3 swAlbedo = texture2D(swOverviewColor, swOverviewUV).rgb;
  vec4 swCoast = texture2D(swOverviewCoast, swOverviewUV);
  vec2 swCellUV = fract(swUV * swOverviewDimensions);
  for(int i=0;i<7;i++) {
    vec4 bounds = swPatchBounds[i];
    if(bounds.z <= 0.0) continue;
    vec2 uv = (swUV - bounds.xy) / bounds.zw;
    if(all(greaterThanEqual(uv,vec2(0))) && all(lessThanEqual(uv,vec2(1)))) {
      vec4 rect = swPatchUV[i];
      vec2 texel = 0.5 / swLocalDimensions;
      vec2 packedUV = clamp(rect.xy+uv*rect.zw, rect.xy+texel, rect.xy+rect.zw-texel);
      swProps = texture2D(swLocalProperties,packedUV);
      swAlbedo = texture2D(swLocalColor,packedUV).rgb;
      swCoast = texture2D(swLocalCoast,packedUV);
      swCellUV = fract(swUV * swMapDimensions);
    }
  }
  float swMapWidth = swMapDimensions.x;
  float swTileWorldSize = 3.3321622036 * length(swSurfacePosition) / swMapWidth;
  float swKnown = smoothstep(0.05,0.95,swProps.b);
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
  vec4 swEdgeDistance = vec4(swCellUV.y, 1.0-swCellUV.x, 1.0-swCellUV.y, swCellUV.x);
  vec4 swCoastDistance = mix(vec4(1.0), swEdgeDistance, swCoast);
  float swShoreDistance = min(min(swCoastDistance.x,swCoastDistance.y),min(swCoastDistance.z,swCoastDistance.w));
  vec3 swWavePosition = swSurfacePosition / max(0.0001, swTileWorldSize);
  float swWaveDetail = 1.0 - smoothstep(0.025, 0.16, swPixelFootprint / swTileWorldSize);
  float swWaveA = sin(dot(swWavePosition, vec3(14.0, 8.0, 19.0)) - swTime * 1.3);
  float swWaveB = sin(dot(swWavePosition, vec3(-31.0, 17.0, 12.0)) + swTime * 1.7);
  float swWaveC = sin(dot(swWavePosition, vec3(53.0, 26.0, -39.0)) - swTime * 2.1);
  float swWaveHeight = (swWaveA * 0.0012 + swWaveB * 0.0006 + swWaveC * 0.0003) * swTileWorldSize * swWaveDetail;
  // Shallow turquoise and a narrow moving foam line require known land/water
  // neighbors. A fog boundary must never imply an undiscovered coastline.
  float swShallow = (1.0 - smoothstep(0.02, 0.32, swShoreDistance)) * swWater * swKnown;
  swAlbedo = mix(swAlbedo, vec3(0.025, 0.22, 0.19), swShallow * 0.65);
  float swFoamEdge = 0.025 + 0.009 * swWaveA;
  float swFoamAA = max(fwidth(swShoreDistance), 0.003);
  float swFoam = (1.0-smoothstep(swFoamEdge,swFoamEdge+swFoamAA,swShoreDistance)) * swWater * swKnown;
  swAlbedo += vec3(0.12, 0.20, 0.19) * swFoam * (0.6 + swWaveB * 0.2);
  // The uncharted hemisphere is a neutral scan veil, never fabricated land/water.
  vec3 swVeil = vec3(0.004, 0.011, 0.023) * (0.97 + swContinental * 0.06);
  swAlbedo = mix(swVeil, swAlbedo, swKnown);
  swAlbedo = mix(swAlbedo * vec3(0.71, 0.78, 0.86), swAlbedo, mix(0.4, 1.0, swProps.a));
  diffuseColor.rgb *= swAlbedo;
  float swHeight = mix((swGrain * 0.012 + swFine * 0.002 + swRidges * swRock * 0.012), swWaveHeight, swWater) * swKnown;
`;

export function createPlanetSurface(radius: number): PlanetSurface {
  const empty = () => atlas(3, 2, () => ({ terrain: 'unknown', explored: false, visible: false }));
  const overview = empty(), local = empty();
  const uniforms: SurfaceState['uniforms'] = {
    swPatchBounds: {value: Array.from({length:7},()=>new THREE.Vector4())}, swPatchUV: {value: Array.from({length:7},()=>new THREE.Vector4())},
    swOverviewColor: { value: overview.color }, swOverviewProperties: { value: overview.properties },
    swLocalColor: { value: local.color }, swLocalProperties: { value: local.properties },
    swOverviewCoast: { value: overview.coast }, swLocalCoast: { value: local.coast },
    swMapDimensions: { value: new THREE.Vector2(3, 2) }, swLocalDimensions: { value: new THREE.Vector2(1, 1) }, swOverviewDimensions: { value: new THREE.Vector2(3, 2) }, swTime: { value: 0 },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.91, metalness: 0.025 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 swSurfacePosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nswSurfacePosition = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + SHADER_HEADER)
      .replace('#include <map_fragment>', SHADER_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.94, mix(0.86 + swGrain * 0.1, 0.36, swWater), swKnown);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColor *= mix(1.0, 0.3, swWater * swKnown);')
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #include <normal_fragment_maps>
        vec3 swDx = dFdx(-vViewPosition), swDy = dFdy(-vViewPosition);
        vec3 swR1 = cross(swDy, normal), swR2 = cross(normal, swDx);
        float swDet = dot(swDx, swR1);
        vec3 swGradient = sign(swDet) * (dFdx(swHeight) * swR1 + dFdy(swHeight) * swR2);
        normal = normalize(abs(swDet) * normal - swGradient);
      `);
  };
  material.customProgramCacheKey = () => 'siliconworld-planet-surface-v2';
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
    'surface_patches' in planet ? planet.surface_patches : null, overview?.terrain, overview?.explored, overview?.visible, overview?.step];
  if (state.source?.every((value, i) => value === source[i])) return;
  state.source = source;
  const unknown = { terrain: 'unknown', explored: false, visible: false };
  const overviewWidth = Math.max(1, overview?.cells_width ?? 3);
  const overviewHeight = Math.max(1, overview?.cells_height ?? 2);
  const sampleOverview = (x: number, y: number): SurfaceSample => overview ? {
    terrain: overview.terrain?.[y]?.[x] ?? 'unknown',
    explored: Boolean(overview.explored?.[y]?.[x]), visible: Boolean(overview.visible?.[y]?.[x]),
  } : unknown;
  const globalAtlas = atlas(overviewWidth, overviewHeight, (x, y) => {
    const cell = sampleOverview(x, y);
    return cell.explored && FINISHES[cell.terrain]?.[1] === 1
      ? { ...cell, coast: coastAt(x, y, overviewWidth / 3, sampleOverview) } : cell;
  });
  const patches = [{bounds, terrain: planet.terrain, explored: effectiveFog?.explored, visible: effectiveFog?.visible}, ...('surface_patches' in planet ? planet.surface_patches ?? [] : [])].slice(0,7);
  const localWidth = Math.max(1,...patches.map(p=>p.bounds.width));
  const localHeight = Math.max(1,patches.reduce((sum,p)=>sum+p.bounds.height,0));
  let offset=0;
  const packed=patches.map(p=>{const result={...p,offset};offset+=p.bounds.height;return result;});
  const sampleLocal = (x: number, y: number): SurfaceSample => {
    const terrain = getTerrainTile(planet, x, y);
    const state = effectiveFog ? getFogState(effectiveFog, x, y) : { explored: terrain !== 'unknown', visible: terrain !== 'unknown' };
    return { terrain, ...state };
  };
  const localAtlas = atlas(localWidth,localHeight,(x,y)=>{
    const patch=packed.find(p=>y>=p.offset&&y<p.offset+p.bounds.height&&x<p.bounds.width);
    if(!patch) return unknown;
    const row=y-patch.offset, terrain=patch.terrain?.[row]?.[x]??'unknown';
    const explored = patch.explored ? Boolean(patch.explored[row]?.[x]) : terrain !== 'unknown';
    return {terrain, explored, visible:patch.visible ? Boolean(patch.visible[row]?.[x]) : terrain!=='unknown',
      coast: explored && FINISHES[terrain]?.[1] === 1 ? coastAt(patch.bounds.x+x, patch.bounds.y+row, planet.surface.face_size, sampleLocal) : undefined};
  });
  state.uniforms.swPatchBounds.value.forEach((v,i)=>{
    const p=packed[i];
    if(!p) {v.set(0,0,0,0);return;}
    v.set(p.bounds.x/planet.map_width,p.bounds.y/planet.map_height,p.bounds.width/planet.map_width,p.bounds.height/planet.map_height);
    state.uniforms.swPatchUV.value[i].set(0,p.offset/localHeight,p.bounds.width/localWidth,p.bounds.height/localHeight);
  });
  for (const previous of [state.overview, state.local]) { previous.color.dispose(); previous.properties.dispose(); previous.coast.dispose(); }
  state.overview = globalAtlas;
  state.local = localAtlas;
  state.uniforms.swOverviewColor.value = globalAtlas.color;
  state.uniforms.swOverviewProperties.value = globalAtlas.properties;
  state.uniforms.swLocalColor.value = localAtlas.color;
  state.uniforms.swLocalProperties.value = localAtlas.properties;
  state.uniforms.swOverviewCoast.value = globalAtlas.coast;
  state.uniforms.swLocalCoast.value = localAtlas.coast;
  state.uniforms.swMapDimensions.value.set(planet.map_width, planet.map_height);
  state.uniforms.swLocalDimensions.value.set(localWidth, localHeight);
  state.uniforms.swOverviewDimensions.value.set(overviewWidth, overviewHeight);
}

export function disposePlanetSurface(mesh: PlanetSurface) {
  const state = states.get(mesh);
  if (state) {
    for (const value of [state.overview, state.local]) { value.color.dispose(); value.properties.dispose(); value.coast.dispose(); }
    states.delete(mesh);
  }
  mesh.geometry.dispose();
  mesh.material.dispose();
}

/** Water motion is presentation time, independent of the authoritative simulation tick. */
export function updatePlanetSurfaceTime(mesh: PlanetSurface, seconds: number) {
  const state = states.get(mesh);
  if (state) state.uniforms.swTime.value = seconds;
}
