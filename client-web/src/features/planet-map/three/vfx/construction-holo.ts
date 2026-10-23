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

  /**
   * 按建筑类型取全息材质（同一个类型全场共享一个材质实例）。
   * 进度是**每实例**的（同一类型可能同时有多处在建），所以每个施工任务克隆一份材质；
   * 克隆只做一次、随任务缓存，不逐帧克隆（§2.5）。类型键只用于命名与调试。
   */
  get(type: string, key = type): THREE.ShaderMaterial {
    let material = this.materials.get(key);
    if (material) return material;
    material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // additive：合并几何的面互相叠加时是「能量叠加变亮」而不是把 alpha 累加到不透明；
      // 普通混合在 3×3/5×5 的实体尺寸上会糊成一块实心青板（实机夹具实测）。
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uProgress: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: HOLO_COLOR.clone() },
        uEdge: { value: HOLO_EDGE.clone() },
        uScan: { value: HOLO_SCANLINES },
        // 溶解高度（格）：每个任务按克隆模型的包围盒写一次（见 `ConstructionHolo.create`）。
        uHeight: { value: 0.62 },
      },
      vertexShader: HOLO_VERTEX,
      fragmentShader: HOLO_FRAGMENT,
    });
    material.name = `holo:${type}`;
    // 类型键上的材质是共享兜底（不在 dispose 时被单个任务释放）。
    if (key === type) material.userData.shared = true;
    this.materials.set(key, material);
    return material;
  }

  /** 释放某个实例的材质（施工完成/取消）。共享键（= 类型）不释放。 */
  release(key: string): void {
    const material = this.materials.get(key);
    if (!material || material.userData.shared) return;
    material.dispose();
    this.materials.delete(key);
  }

  setTime(seconds: number): void {
    for (const material of this.materials.values()) material.uniforms.uTime.value = seconds;
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
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
  uniform float uHeight;

  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;

  void main() {
    // 模型局部单位 = 1 格；高度按该任务的包围盒归一（uHeight，3×3 约 1.6 格、5×5 约 3.4 格）。
    float height = clamp(vLocal.y / max(uHeight, 0.05), 0.0, 1.0);
    // 显形前沿：进度线下方实心，上方溶解；前沿 0.08 宽度做柔化。
    float reveal = smoothstep(height, height + 0.08, uProgress);
    if (reveal <= 0.001) discard;

    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 3.0);
    // 扫描线：沿高度流动的细亮条（冻结时 uTime 固定 → 画面定格）。
    // 扫描线：在 0.45–1.0 之间取值，暗带仍然可见（纯 smoothstep(0.86,1.0) 只剩几条细亮线，
    // 大块合并几何上读不出「全息」）。
    float scan = 0.45 + 0.55 * smoothstep(0.55, 1.0, sin((vLocal.y * uScan) - uTime * 5.0) * 0.5 + 0.5);

    vec3 color = mix(uColor, uEdge, fresnel * 0.8 + scan * 0.35);
    // 基础半透明 + 菲涅尔边 + 前沿亮线。
    // 基础填充压到 .03：静态合批后一个建筑是一整块合并几何，双面渲染下多层壳叠加，
    // 旧值 .07 在 3×3 实体尺寸上会糊成一块不透明青色板（只能读出「一坨青」）。
    float front = smoothstep(0.0, 0.06, uProgress - height) * (1.0 - smoothstep(0.06, 0.14, uProgress - height));
    // additive 下多层壳会相加：单层权重必须小（0.01–0.12 量级），否则 3×3 的合并几何叠成一片白。
    float alpha = (0.012 + fresnel * 0.13 + scan * 0.035 + front * 0.22) * reveal;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.35));
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

/** 场景侧的施工任务输入（进度已按 `constructionBarProgress` 归一）。 */
export interface HoloTask {
  id: string;
  buildingType: string;
  position: { x: number; y: number };
  rotation?: number;
  /** 占地（格）。 */
  width: number;
  height: number;
  /** 0..1；null = 无法计算进度（只画边光轮廓，不溶解）。 */
  progress: number | null;
}

/**
 * 施工全息层：按任务 id 复用模型与材质；进度只写 uniform。
 *
 * - 模型来自 `IndustrialModels.building`（与实物同一套几何，缓存共享）；
 * - 每个任务一份全息材质克隆（进度是每实例的），任务结束释放；
 * - 任务消失（完工或取消）时在格上打一次闪光环。
 */
export class ConstructionHolo {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, { holder: THREE.Group; material: THREE.ShaderMaterial; task: HoloTask }>();

  constructor(
    parent: THREE.Object3D,
    private readonly models: { building(type: string, width: number, depth: number, own: boolean): THREE.Object3D },
    private readonly materials: HoloMaterials,
    private readonly radius: number,
    private readonly scale: () => number,
    private readonly flash: ConstructionFlash,
    private readonly normalOf: (tile: { x: number; y: number }) => THREE.Vector3,
  ) {
    this.group.name = 'construction-holo';
    parent.add(this.group);
  }

  /** 同步任务集合（签名不变时只更新进度 uniform）。 */
  sync(tasks: readonly HoloTask[], faceSize: number): void {
    void faceSize;
    const live = new Set<string>();
    for (const task of tasks) {
      live.add(task.id);
      let entry = this.entries.get(task.id);
      if (!entry || entry.task.buildingType !== task.buildingType || entry.task.width !== task.width || entry.task.height !== task.height) {
        if (entry) { entry.holder.removeFromParent(); this.materials.release(`task:${task.id}`); }
        entry = this.create(task);
        this.entries.set(task.id, entry);
      }
      entry.task = task;
      const progress = task.progress ?? 0;
      entry.material.uniforms.uProgress.value = progress;
      // 位置/朝向（任务可能旋转过，且跨面时需要重算法线）。
      const normal = this.normalOf(task.position);
      const ts = this.scale();
      const center = new THREE.Vector3();
      for (let dy = 0; dy < task.height; dy++) for (let dx = 0; dx < task.width; dx++) {
        center.add(this.normalOf({ x: task.position.x + dx, y: task.position.y + dy }));
      }
      center.normalize();
      entry.holder.position.copy(center).multiplyScalar(this.radius + ts * 0.025);
      const east = this.normalOf({ x: task.position.x + 0.001, y: task.position.y }).sub(normal);
      east.addScaledVector(normal, -east.dot(normal)).normalize();
      const south = new THREE.Vector3().crossVectors(east, normal).normalize();
      entry.holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, normal, south));
      entry.holder.rotateY(-Number(task.rotation ?? 0) * Math.PI / 180);
      entry.holder.scale.setScalar(ts);
    }
    for (const [id, entry] of this.entries) {
      if (live.has(id)) continue;
      // 任务结束：完工闪光（取消也打一次，读起来是「这一格有动静」）。
      this.flash.spawn(entry.holder.position.clone(), this.normalOf(entry.task.position));
      entry.holder.removeFromParent();
      this.materials.release(`task:${id}`);
      this.entries.delete(id);
    }
  }

  /**
   * 全息分身：克隆**整棵模型树**（保留根 `scale`、嵌套 Group 与旋转件的偏移），只把网格材质
   * 换成共享的全息材质。
   *
   * 旧实现把每个 mesh 拍平到 holder 下，丢了根 `scale = (w×.86, …, d×.86)`：3×3 装配台的全息
   * 包围盒只有实物的 ~half，5×5 基站差近 3 倍（审查 M1）。溶解高度改为按**克隆后的包围盒**
   * 归一（`uHeight` uniform），不再写死 0.62 格。
   */
  private create(task: HoloTask): { holder: THREE.Group; material: THREE.ShaderMaterial; task: HoloTask } {
    const holder = new THREE.Group();
    const model = this.models.building(task.buildingType, task.width * 0.86, task.height * 0.86, true);
    const material = this.materials.get(task.buildingType, `task:${task.id}`);
    // 模型是共享缓存的：克隆整棵树，只换材质，不碰原模型的几何/材质。
    const clone = model.clone(true);
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.material = material;
      object.renderOrder = 14;
    });
    holder.add(clone);
    // 溶解高度：着色器里的 `vLocal` 是**根 scale 之前**的模型空间（`IndustrialModels.batchStatic`
    // 把各部件矩阵烘进几何、再恢复根 scale），所以量包围盒时也要把根 scale 归一成 1。
    const rootScale = clone.scale.clone();
    clone.scale.setScalar(1);
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    clone.scale.copy(rootScale);
    clone.updateMatrixWorld(true);
    material.uniforms.uHeight.value = Math.max(0.05, box.max.y);
    this.group.add(holder);
    return { holder, material, task };
  }

  get count(): number { return this.entries.size; }

  dispose(): void {
    for (const [id, entry] of this.entries) {
      entry.holder.removeFromParent();
      this.materials.release(`task:${id}`);
    }
    this.entries.clear();
    this.group.removeFromParent();
  }
}
