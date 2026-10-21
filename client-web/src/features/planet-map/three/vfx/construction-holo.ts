/**
 * 施工全息（3A 画质 vfx 分支）。
 *
 * 取代旧的「四角脚手架立柱」：按施工任务的建筑类型给出**目标模型的全息分身**——
 * 青色半透明 + 菲涅尔边 + 扫描线，按施工进度自下而上溶解显形。
 *
 * 约定（plan.md 步骤 6 / 3A 画质 §2）：
 * - 进度取现有进度条同一口径（`constructionBarProgress`：remaining/total）；
 * - 全息材质按建筑类型共享（不逐实例克隆），进度只写 uniform；
 * - 完工一次闪光 + 光环（`completionFlash`），拆除反向溶解（`progress` 递减时同样成立）；
 * - 冻结时进度固定（由场景传固定 progress），画面确定。
 */

import * as THREE from 'three';

/** 全息主色（己方发光青）与边光。 */
export const HOLO_COLOR = new THREE.Color('#3fe6ff');
export const HOLO_EDGE = new THREE.Color('#9ff6ff');
/** 扫描线密度（世界单位，每格几条）。 */
export const HOLO_SCANLINES = 26;

/** 全息材质工厂：按建筑类型缓存（几何由 `IndustrialModels` 共享，材质在这里共享）。 */
export class HoloMaterials {
  private readonly materials = new Map<string, THREE.ShaderMaterial>();
  private readonly flashMaterial = new THREE.MeshBasicMaterial({
    color: HOLO_EDGE, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });

  /** 按建筑类型取全息材质（同一个类型全场共享一个材质实例）。 */
  get(type: string): THREE.ShaderMaterial {
    let material = this.materials.get(type);
    if (material) return material;
    material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uProgress: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: HOLO_COLOR.clone() },
        uEdge: { value: HOLO_EDGE.clone() },
        uScan: { value: HOLO_SCANLINES },
      },
      vertexShader: HOLO_VERTEX,
      fragmentShader: HOLO_FRAGMENT,
    });
    material.name = `holo:${type}`;
    this.materials.set(type, material);
    return material;
  }

  /** 完工闪光材质（叠加混合，由场景按时序改 opacity）。 */
  get flash(): THREE.MeshBasicMaterial { return this.flashMaterial; }

  /** 全场进度/时间更新（同一类型的实例共享材质，一次写入全部生效）。 */
  setProgress(type: string, progress: number): void {
    const material = this.materials.get(type);
    if (material) material.uniforms.uProgress.value = Math.min(1, Math.max(0, progress));
  }

  setTime(seconds: number): void {
    for (const material of this.materials.values()) material.uniforms.uTime.value = seconds;
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.flashMaterial.dispose();
  }
}

/**
 * 溶解显形：世界坐标高度（局部 +Y）低于「进度线」的部分实心，之上只留菲涅尔边。
 * 菲涅尔用视空间法线与视线夹角；扫描线是随时间流动的细亮条（冻结时固定相位）。
 */
const HOLO_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;

  void main() {
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const HOLO_FRAGMENT = /* glsl */ `
  uniform float uProgress;
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uEdge;
  uniform float uScan;

  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;

  void main() {
    // 局部 Y 归一化到 0..1：模型局部单位 = 1 格，占高约 1.2 格（地基 + 机身）。
    float height = clamp((vLocal.y + 0.05) / 1.2, 0.0, 1.0);
    // 显形前沿：进度线下方实心，上方溶解；前沿 0.08 宽度做柔化。
    float reveal = smoothstep(height, height + 0.08, uProgress);
    if (reveal <= 0.001) discard;

    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
    // 扫描线：沿高度流动的细亮条（冻结时 uTime 固定 → 画面定格）。
    float scan = smoothstep(0.86, 1.0, sin((vLocal.y * uScan) - uTime * 5.0) * 0.5 + 0.5);

    vec3 color = mix(uColor, uEdge, fresnel * 0.8 + scan * 0.35);
    // 基础半透明 + 菲涅尔边 + 前沿亮线。
    float front = smoothstep(0.0, 0.06, uProgress - height) * (1.0 - smoothstep(0.06, 0.14, uProgress - height));
    float alpha = (0.16 + fresnel * 0.55 + scan * 0.12 + front * 0.7) * reveal;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.92));
  }
`;

/**
 * 完工闪光 + 光环：一次性扩散的贴地环（场景在任务从列表消失时触发）。
 * 用简单 mesh 池：同时最多 4 个。
 */
export class ConstructionFlash {
  readonly group = new THREE.Group();
  private readonly ring = new THREE.RingGeometry(0.8, 1, 48);
  private readonly pool: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; elapsed: number; duration: number; normal: THREE.Vector3 }[] = [];
  private readonly radius: number;
  private readonly scale: () => number;

  constructor(parent: THREE.Object3D, radius: number, scale: () => number) {
    this.radius = radius;
    this.scale = scale;
    this.group.name = 'construction-flash';
    parent.add(this.group);
  }

  /** 在格上触发一次闪光。 */
  spawn(tile: THREE.Vector3, normal: THREE.Vector3): void {
    let entry = this.pool.find((item) => item.elapsed >= item.duration);
    if (!entry) {
      if (this.pool.length >= 4) entry = this.pool.shift()!;
      else {
        const material = new THREE.MeshBasicMaterial({
          color: HOLO_EDGE, transparent: true, opacity: 0, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
        });
        entry = { mesh: new THREE.Mesh(this.ring, material), material, elapsed: 0, duration: 0.7, normal: new THREE.Vector3() };
        this.pool.push(entry);
        this.group.add(entry.mesh);
      }
    }
    entry.normal.copy(normal).normalize();
    entry.mesh.position.copy(tile).normalize().multiplyScalar(this.radius + this.scale() * 0.04);
    entry.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), entry.normal);
    entry.elapsed = 0;
    entry.duration = 0.7;
    entry.mesh.visible = true;
  }

  update(dt: number): void {
    for (const entry of this.pool) {
      if (entry.elapsed >= entry.duration) { entry.mesh.visible = false; continue; }
      entry.elapsed += Math.max(0, dt);
      const t = Math.min(entry.elapsed / entry.duration, 1);
      entry.mesh.scale.setScalar(this.scale() * (0.6 + t * 1.8));
      entry.material.opacity = 0.85 * (1 - t) ** 1.5;
    }
  }

  dispose(): void {
    for (const entry of this.pool) { entry.mesh.removeFromParent(); entry.material.dispose(); }
    this.pool.length = 0;
    this.ring.dispose();
    this.group.removeFromParent();
  }
}
