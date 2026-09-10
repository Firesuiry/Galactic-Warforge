import * as THREE from 'three';

export type IndustrialFinishName = 'ceramic' | 'alloy' | 'graphite';
export interface IndustrialFinishMaps {
  /** Neutral tint modulation. Keep the model's existing material color and metalness. */
  map: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  normalScale: THREE.Vector2;
  /** Roughness texture stores the absolute roughness rather than multiplying the old value. */
  roughness: number;
}
export type IndustrialFinishes = Record<IndustrialFinishName, IndustrialFinishMaps> & { dispose(): void };
export interface IndustrialFinishOptions {
  size?: 128 | 256;
  /** Caller can cap this at renderer.capabilities.getMaxAnisotropy(). */
  anisotropy?: number;
}

const TAU = Math.PI * 2;
const smooth = (a: number, b: number, value: number) => {
  const t = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const distance = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
const band = (value: number, center: number, halfWidth: number, pixel: number) => 1 - smooth(halfWidth, halfWidth + pixel, distance(value, center));
const hash = (index: number) => {
  let bits = Math.imul(index ^ 0x7b13a59d, 0x45d9f3b);
  bits = Math.imul(bits ^ bits >>> 16, 0x45d9f3b);
  return ((bits ^ bits >>> 16) >>> 0) / 4294967295;
};

function surface(finish: IndustrialFinishName, u: number, v: number, pixel: number): [number, number, number] {
  // Low-frequency manufacturing variation, never unfiltered per-pixel noise.
  const grain = Math.sin(u * TAU * 3 + Math.sin(v * TAU * 2)) * Math.sin(v * TAU * 4);
  if (finish === 'ceramic') {
    const seam = Math.max(band(u, 0, .003, pixel), band(v, 0, .003, pixel), band(u, .5, .002, pixel));
    let fastener = 0, rim = 0;
    for (const x of [.055, .445, .555, .945]) for (const y of [.055, .945]) {
      const d = Math.hypot(distance(u, x), distance(v, y));
      fastener = Math.max(fastener, 1 - smooth(.004, .004 + pixel, d));
      rim = Math.max(rim, (1 - smooth(.009, .009 + pixel, d)) * smooth(.005, .005 + pixel, d));
    }
    return [1 - seam * .25 - fastener * .27 - rim * .075 + grain * .007,
      .5 + seam * .15 + fastener * .08 + grain * .012,
      -seam * .58 - fastener * .4 + rim * .06];
  }
  if (finish === 'alloy') {
    const brushing = Math.sin(v * TAU * 22 + .2 * Math.sin(u * TAU * 2));
    let scratch = 0;
    // Twelve long, faint machining lines per face; each has a pixel-soft edge.
    for (let i = 0; i < 12; i++) {
      const start = hash(i * 3) * .8;
      const length = .12 + hash(i * 3 + 1) * .25;
      const along = ((u - start) % 1 + 1) % 1;
      const envelope = smooth(0, .035, along) * (1 - smooth(length - .035, length, along));
      scratch = Math.max(scratch, band(v, hash(i * 3 + 2), pixel * .28, pixel) * envelope);
    }
    return [.97 + brushing * .006 + grain * .007 - scratch * .034,
      .43 + brushing * .025 + grain * .014 + scratch * .06,
      brushing * .015 - scratch * .075];
  }
  // Graphite service plates: broad frame with recessed, restrained transverse grille.
  const border = Math.max(band(u, 0, .014, pixel), band(v, 0, .014, pixel));
  const inset = smooth(.11, .13, u) * (1 - smooth(.87, .89, u))
    * smooth(.13, .15, v) * (1 - smooth(.85, .87, v));
  let slot = 0;
  for (let i = 0; i < 7; i++) slot = Math.max(slot, band(v, .2 + i * .1, .012, pixel));
  slot *= inset;
  return [.98 - slot * .2 - border * .13 + grain * .01,
    .55 + slot * .13 + border * .08 + grain * .015,
    -slot * .62 - border * .3];
}

function texture(data: Uint8Array, size: number, name: string, colorSpace: THREE.ColorSpace, anisotropy: number) {
  const result = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  result.name = name;
  result.colorSpace = colorSpace;
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.magFilter = THREE.LinearFilter;
  result.minFilter = THREE.LinearMipmapLinearFilter;
  result.generateMipmaps = true;
  result.anisotropy = anisotropy;
  result.needsUpdate = true;
  return result;
}

/** Original deterministic PBR detail, generated once per model library. No DOM or network.
 * Standard primitive UVs are retained by IndustrialModels' merged geometry: one pattern
 * per UV island. Reuse these textures; do not clone them per building/mesh. Dispose only
 * after the owning library's shared materials stop rendering.
 */
export function createIndustrialFinishes(options: IndustrialFinishOptions = {}): IndustrialFinishes {
  const size = options.size ?? 256;
  const anisotropy = Math.max(1, Math.min(8, Math.floor(options.anisotropy ?? 4)));
  const textures: THREE.DataTexture[] = [];
  const create = (finish: IndustrialFinishName): IndustrialFinishMaps => {
    const color = new Uint8Array(size * size * 4), roughness = new Uint8Array(size * size * 4);
    const normal = new Uint8Array(size * size * 4), heights = new Float32Array(size * size);
    const byte = (value: number) => Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const [tint, rough, height] = surface(finish, (x + .5) / size, (y + .5) / size, 1 / size);
      const index = y * size + x, offset = index * 4;
      // Tint is a linear reflectance multiplier; store sRGB-encoded color bytes.
      color[offset] = color[offset + 1] = color[offset + 2] = byte(tint <= .0031308 ? tint * 12.92 : 1.055 * Math.pow(Math.max(0, tint), 1 / 2.4) - .055);
      roughness[offset] = roughness[offset + 1] = roughness[offset + 2] = byte(rough);
      color[offset + 3] = roughness[offset + 3] = 255;
      heights[index] = height;
    }
    const sample = (x: number, y: number) => heights[((y + size) % size) * size + (x + size) % size];
    const n = new THREE.Vector3();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      // Tangent-space +Y normal map. Wrapped central differences keep repeat seams continuous.
      n.set(-(sample(x + 1, y) - sample(x - 1, y)) * .65,
        -(sample(x, y + 1) - sample(x, y - 1)) * .65, 1).normalize();
      const offset = (y * size + x) * 4;
      normal[offset] = byte(n.x * .5 + .5); normal[offset + 1] = byte(n.y * .5 + .5);
      normal[offset + 2] = byte(n.z * .5 + .5); normal[offset + 3] = 255;
    }
    const map = texture(color, size, `industrial-${finish}-color`, THREE.SRGBColorSpace, anisotropy);
    const roughnessMap = texture(roughness, size, `industrial-${finish}-roughness`, THREE.NoColorSpace, anisotropy);
    const normalMap = texture(normal, size, `industrial-${finish}-normal`, THREE.NoColorSpace, anisotropy);
    textures.push(map, roughnessMap, normalMap);
    return { map, roughnessMap, normalMap, normalScale: new THREE.Vector2(.7, .7), roughness: 1 };
  };
  let disposed = false;
  return { ceramic: create('ceramic'), alloy: create('alloy'), graphite: create('graphite'), dispose() {
    if (disposed) return;
    disposed = true;
    textures.forEach(item => item.dispose());
  } };
}
