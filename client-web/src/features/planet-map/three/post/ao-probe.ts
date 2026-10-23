import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * AO 探针（审查 P1-3 的验收工具）：把 GTAO 的降噪 AO 贴图渲染到一张 RGBA8 小目标上，
 * 用 `readRenderTargetPixels` 读回来做统计。
 *
 * 为什么需要它：AO 贴图是 HalfFloat，`readRenderTargetPixels` 对 HalfFloat 的读回依赖
 * 扩展、且按 Uint16 解释，跨驱动不稳；AO 值在 0–1，经一次 8 位编码对验收（< 0.85）
 * 足够。只读不写场景状态，渲染目标用完恢复。
 *
 * 画面验收用它断言「夹具 industry-overview 建筑底部 AO < 0.85」；单测只覆盖纯函数部分。
 */
export interface AoStats {
  /** 0–1 的最小值（最深的遮蔽）。 */
  min: number;
  mean: number;
  max: number;
  /** 参与统计的像素数。 */
  samples: number;
  /** 归一化屏幕区域（左下原点，与 gl 一致）；不传 = 全屏。 */
  region: { x: number; y: number; width: number; height: number };
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D tAo;
  uniform vec4 region;
  varying vec2 vUv;
  void main() {
    // 只关心区域内；区域外写 1（无遮蔽）不影响区域统计。
    vec2 uv = region.xy + vUv * region.zw;
    gl_FragColor = vec4(texture2D(tAo, uv).r, 0.0, 0.0, 1.0);
  }
`;

export class AoProbe {
  private readonly target = new THREE.WebGLRenderTarget(64, 64, { type: THREE.UnsignedByteType, depthBuffer: false });
  private readonly material = new THREE.ShaderMaterial({
    uniforms: {
      tAo: { value: null as THREE.Texture | null },
      region: { value: new THREE.Vector4(0, 0, 1, 1) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  private readonly quad = new FullScreenQuad(this.material);
  private readonly pixels = new Uint8Array(64 * 64 * 4);

  /**
   * 读一次 AO 统计。`region` 用归一化坐标（0–1，左下原点）；默认全屏。
   * `resolution` 是 AO 贴图分辨率（决定采样数，探针固定采 64×64 个点）。
   */
  measure(renderer: THREE.WebGLRenderer, aoTexture: THREE.Texture | null, region?: Partial<AoStats['region']>): AoStats | null {
    if (!aoTexture) return null;
    const full = { x: 0, y: 0, width: 1, height: 1 };
    const area = {
      x: region?.x ?? full.x,
      y: region?.y ?? full.y,
      width: region?.width ?? full.width,
      height: region?.height ?? full.height,
    };
    const size = 64;
    if (this.target.width !== size) {
      this.target.setSize(size, size);
      this.pixels.fill(0);
    }
    const previous = renderer.getRenderTarget();
    this.material.uniforms.tAo.value = aoTexture;
    (this.material.uniforms.region.value as THREE.Vector4).set(area.x, area.y, area.width, area.height);
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    renderer.readRenderTargetPixels(this.target, 0, 0, size, size, this.pixels);
    renderer.setRenderTarget(previous);
    return aoStats(this.pixels, size, area);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

/**
 * 从 RGBA8 像素缓冲统计 R 通道（0–1）。纯函数，单测覆盖。
 * `skipTransparent` 以外的像素全部计入：AO 探针的目标每像素都是不透明的。
 */
export function aoStats(pixels: Uint8Array, size: number, region: AoStats['region']): AoStats {
  let min = 1;
  let max = 0;
  let sum = 0;
  let samples = 0;
  for (let i = 0; i < size * size; i++) {
    const value = pixels[i * 4] / 255;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    samples += 1;
  }
  return { min, mean: samples ? sum / samples : 0, max, samples, region };
}
