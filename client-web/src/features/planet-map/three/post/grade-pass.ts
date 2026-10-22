import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * 调色 pass（第 23 轮 3A 画质）：在 `OutputPass` 之后、显示空间（sRGB）里工作。
 *
 * - lift / gamma / gain（暗部抬升、中间调、高光），高光暖暗部冷的分离色调；
 * - 饱和度 1.05、对比 1.06；
 * - 暗角 0.18；
 * - 极轻胶片颗粒 0.015：`freeze` 时固定相位（噪声只与屏幕坐标有关，逐帧字节一致）。
 *
 * 顺序：OutputPass（ACES + sRGB 编码）→ 本 pass → SMAA（samples==0 时）。
 * 调色必须在显示空间做，否则 ACES 会把暗角/颗粒也压成线性值，暗部颗粒看不见。
 */

export interface GradeOptions {
  lift: number;
  gamma: number;
  gain: number;
  saturation: number;
  contrast: number;
  /** 分离色调：高光暖 / 暗部冷的强度（0–1）。 */
  splitTone: number;
  /** 暗角强度（0–1）。 */
  vignette: number;
  /** 颗粒强度（0–1，0.015 为「极轻」）。 */
  grain: number;
}

export const GRADE_TUNING: GradeOptions = {
  lift: 0.012,
  gamma: 0.98,
  gain: 1.02,
  saturation: 1.05,
  contrast: 1.06,
  splitTone: 0.35,
  vignette: 0.18,
  grain: 0.015,
};

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float lift;
  uniform float gamma;
  uniform float gain;
  uniform float saturation;
  uniform float contrast;
  uniform float splitTone;
  uniform float vignette;
  uniform float grain;
  uniform float frame;
  uniform float frozen;
  varying vec2 vUv;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    vec3 color = texture2D(tDiffuse, vUv).rgb;

    // lift / gamma / gain（ASC CDL 的简化形式）：lift 抬暗部、gain 压高光、gamma 调中间调。
    color = pow(max(color + lift * (1.0 - color), vec3(0.0)), vec3(gamma));
    color *= gain;

    // 对比（围绕 0.5 中灰）。
    color = (color - 0.5) * contrast + 0.5;

    // 饱和度。
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, saturation);

    // 分离色调：高光暖（+R -B）、暗部冷（-R +B）。
    // 3A 第二轮 §13：高光那一档略加强、暗部冷色收窄（原来青色分量太重，陶瓷白受光面被染冰蓝，
    // 阴影发青绿）。冷色只压 R、抬一点 B，G 保持中性。
    float luma2 = dot(color, vec3(0.2126, 0.7152, 0.0722));
    vec3 warm = vec3(0.055, 0.020, -0.040);
    vec3 cool = vec3(-0.024, 0.000, 0.036);
    color += mix(cool, warm, smoothstep(0.25, 0.85, luma2)) * splitTone;

    // 暗角（椭圆、以画面中心为准，长边方向更宽）。
    vec2 centered = vUv - 0.5;
    centered.x *= 1.15;
    float radius = length(centered) * 1.6;
    float edge = smoothstep(0.55, 1.05, radius);
    color *= 1.0 - edge * vignette;

    // 胶片颗粒：冻结时用固定相位（只与屏幕坐标有关），否则每帧换种子。
    vec2 grainUv = vUv * vec2(1920.0, 1080.0) + (frozen > 0.5 ? vec2(17.0, 31.0) : vec2(mod(frame, 64.0) * 13.0, mod(frame, 61.0) * 7.0));
    float noise = hash(floor(grainUv)) - 0.5;
    // 颗粒在中间调最明显，纯黑/纯白收一点。
    float grainWeight = 1.0 - abs(luma2 - 0.5) * 1.4;
    color += noise * grain * grainWeight;

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

export class GradePass {
  /** 与 EffectComposer 的 Pass 接口兼容（不继承 three 的 Pass 类，避免类型/模块耦合）。 */
  readonly isPass = true;
  enabled = true;
  needsSwap = true;
  clear = false;
  renderToScreen = false;
  readonly options: GradeOptions;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private frame = 0;
  private frozen: boolean;

  constructor(options: Partial<GradeOptions> = {}, frozen = false) {
    this.options = { ...GRADE_TUNING, ...options };
    this.frozen = frozen;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        lift: { value: this.options.lift },
        gamma: { value: this.options.gamma },
        gain: { value: this.options.gain },
        saturation: { value: this.options.saturation },
        contrast: { value: this.options.contrast },
        splitTone: { value: this.options.splitTone },
        vignette: { value: this.options.vignette },
        grain: { value: this.options.grain },
        frame: { value: 0 },
        frozen: { value: frozen ? 1 : 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setFrozen(frozen: boolean) {
    this.frozen = frozen;
    this.material.uniforms.frozen.value = frozen ? 1 : 0;
  }

  /** 颗粒强度（0 关闭：冻结截图与「低配」仍保留极轻颗粒，这里是给调试用的）。 */
  setGrain(value: number) {
    this.material.uniforms.grain.value = value;
  }

  setSize() { /* 全屏 quad 不需要尺寸。 */ }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    if (!this.frozen) this.frame += 1;
    this.material.uniforms.frame.value = this.frame % 4096;
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
