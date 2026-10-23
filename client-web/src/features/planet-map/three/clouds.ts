/**
 * 云层（第 23 轮 3A 画质地表分支）。
 *
 * 半径 101.2 的云壳（大气壳 ≈ 102.5 在外，见光照分支），fbm 云 + 缓慢旋转。
 *
 * 约束：
 * - **不泄露信息**：云覆盖率只由世界坐标噪声决定，与探索/迷雾/地形无关，未探索区上方的云
 *   和已探索区一样，不暗示任何隐藏地形；
 * - **冻结确定性**：云只依赖 `swCloudTime`，冻结时写 0（固定相位、固定形状）；
 * - 相机高度：贴地（altitude < 30）完全透明，升到 90 以上满显——地面视角不会被云盖住，
 *   中空/全球视角才看到云层；
 * - 纯装饰：禁用 `raycast`，不参与拾取。
 */
import * as THREE from 'three';

/** 云壳半径（相对行星半径 100）。 */
export const CLOUD_RADIUS = 101.2;

export interface CloudOptions {
  /** 太阳方向（对象空间，场景每帧写入）：只影响云的明暗面。 */
  sun?: THREE.Vector3;
}

const VERTEX = /* glsl */`
  varying vec3 swCloudPosition;
  varying vec3 swCloudNormal;
  void main() {
    swCloudPosition = position;
    swCloudNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */`
  uniform float swCloudTime;
  uniform float swCloudAltitude;
  uniform vec3 swCloudSun;
  varying vec3 swCloudPosition;
  varying vec3 swCloudNormal;

  float swCloudHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.17, 0.43, 0.71));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float swCloudNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(swCloudHash(i), swCloudHash(i + vec3(1,0,0)), f.x),
      mix(swCloudHash(i + vec3(0,1,0)), swCloudHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(swCloudHash(i + vec3(0,0,1)), swCloudHash(i + vec3(1,0,1)), f.x),
      mix(swCloudHash(i + vec3(0,1,1)), swCloudHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float swCloudFbm(vec3 p) {
    return swCloudNoise(p) * 0.52 + swCloudNoise(p * 2.07 + 11.3) * 0.28
      + swCloudNoise(p * 4.11 + 27.9) * 0.14 + swCloudNoise(p * 8.3) * 0.06;
  }

  void main() {
    // 世界坐标（云壳只绕行星旋转，不缩放）：覆盖率与地形/探索完全无关。
    vec3 p = normalize(swCloudPosition);
    float latitude = p.y;
    // 纬度带：赤道与中纬多云、两极少云（只影响观感，不携带任何隐藏数据）。
    float band = 0.72 + 0.28 * smoothstep(0.75, 0.15, abs(latitude));
    // 两层缓慢漂移的 fbm（时间只在 swCloudTime；冻结 = 0 即固定相位）。
    vec3 driftA = p * 5.4 + vec3(swCloudTime * 0.012, 0.0, swCloudTime * 0.008);
    vec3 driftB = p * 11.7 + vec3(-swCloudTime * 0.017, swCloudTime * 0.004, 0.0);
    float density = swCloudFbm(driftA) * 0.68 + swCloudFbm(driftB) * 0.32;
    float coverage = smoothstep(0.48, 0.74, density * band);
    // 边缘细碎：把覆盖率再乘一层高频噪声，避免整片「奶油壳」。
    coverage *= 0.55 + 0.45 * smoothstep(0.35, 0.8, swCloudFbm(p * 23.0 + 3.7));
    // 相机高度淡入：贴地全透明，中空以上满显。
    float altitude = smoothstep(30.0, 90.0, swCloudAltitude);
    // 明暗：朝太阳的一侧亮，背面偏冷灰（只做体积感，不采样场景光照）。
    float light = clamp(dot(normalize(swCloudNormal), normalize(swCloudSun)) * 0.5 + 0.62, 0.0, 1.0);
    vec3 color = mix(vec3(0.55, 0.61, 0.68), vec3(0.97, 0.98, 1.0), light);
    float alpha = coverage * altitude;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha * 0.86);
  }
`;

/** 创建云壳（`radius` 为行星半径，云壳固定在其 1.012 倍处）。 */
export function createClouds(radius: number, options: CloudOptions = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      swCloudTime: { value: 0 },
      swCloudAltitude: { value: 300 },
      swCloudSun: { value: (options.sun ?? new THREE.Vector3(0.4, 0.7, 0.6)).clone().normalize() },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * CLOUD_RADIUS / 100, 128, 96), material);
  mesh.name = 'planet-clouds';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // 纯装饰：拾取永远打在数学球面上。
  mesh.raycast = () => {};
  return mesh;
}

export type PlanetClouds = ReturnType<typeof createClouds>;

/** 每帧更新（冻结时 `seconds = 0`，`altitude` 用当前相机高度）。 */
export function updateClouds(clouds: PlanetClouds, { seconds, altitude, sun }: { seconds: number; altitude: number; sun?: THREE.Vector3 }) {
  const uniforms = clouds.material.uniforms;
  uniforms.swCloudTime.value = seconds;
  uniforms.swCloudAltitude.value = altitude;
  if (sun) uniforms.swCloudSun.value.copy(sun).normalize();
}

export function disposeClouds(clouds: PlanetClouds) {
  clouds.geometry.dispose();
  clouds.material.dispose();
}
