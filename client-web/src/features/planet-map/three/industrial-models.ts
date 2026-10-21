import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { IndustrialSurfaces } from './industrial-surfaces';
import { preloadIndustrialMaterials } from './industrial-materials';
import { instantiateBuilding, instantiateUnit, preloadIndustrialGltf } from './industrial-gltf';
import type { UnitFaction } from '../rts-commands';
import type { SurfaceKey } from './industrial-surfaces';

type Finish = 'ceramic' | 'alloy' | 'graphite' | 'plate' | 'plastic' | 'copper' | 'copperDark' | 'blue' | 'orange' | 'glass' | 'rubber' | 'hostile' | 'fog' | 'fogGlow' | 'fogHostile' | 'fogHostileGlow' | 'warning' | 'hazard';
/** 材质池键：程序化模型用到的 finish 名映射到 `industrial-surfaces.ts` 的表面族。 */
const SURFACE_KEY: Record<Finish, SurfaceKey> = {
  ceramic: 'ceramic', alloy: 'alloy', graphite: 'graphite', plate: 'plate', plastic: 'plastic',
  copper: 'copper', copperDark: 'copperDark', blue: 'blue', orange: 'orange', glass: 'glass',
  rubber: 'rubber', hostile: 'enemyCeramic', fog: 'fogCeramic', fogGlow: 'fogGlow',
  fogHostile: 'fogCeramic', fogHostileGlow: 'fogHostileGlow', warning: 'warning', hazard: 'hazard',
};
/** 单位涂装：己方白蓝、敌方玩家橙、黑雾中立暗紫灰、黑雾敌对暗红。 */
const UNIT_FINISH: Record<UnitFaction, { armor: Finish; light: Finish }> = {
  own: { armor: 'ceramic', light: 'blue' },
  enemy: { armor: 'hostile', light: 'orange' },
  fog_neutral: { armor: 'fog', light: 'fogGlow' },
  fog_hostile: { armor: 'fogHostile', light: 'fogHostileGlow' },
};
type Rotation = { object: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number };
const UP = new THREE.Vector3(0, 1, 0);

/** Original, shared industrial assets. Coordinates: +Y up, X/Z footprint, ground at Y=0.
 * All motion is cosmetic; no resource production or unit simulation happens here.
 */
export class IndustrialModels {
  private readonly geometry = new Map<string, THREE.BufferGeometry>();
  private readonly material = new Map<string, THREE.MeshStandardMaterial>();
  private readonly rotations: Rotation[] = [];
  private readonly merged = new Set<THREE.BufferGeometry>();
  private disposed = false;
  private readonly templates = new Map<string, THREE.Group>();
  /** 表面材质池（PBR 贴图就绪前用程序纹理，就绪后 `upgradeSurfaces()` 换掉并重建模板）。 */
  private readonly surfaces = new IndustrialSurfaces();

  constructor() {
    this.bindSurfaces();
    this.geometry.set('box', new RoundedBoxGeometry(1, 1, 1, 1, 0.06));
    this.geometry.set('slab', new THREE.BoxGeometry(1, 1, 1));
    this.geometry.set('cylinder', new THREE.CylinderGeometry(0.5, 0.5, 1, 16));
    // 细管/细杆：8 段够圆（半径 ≤ 0.02 格），16 段是纯浪费（塔架每栋几十根）。
    this.geometry.set('tube', new THREE.CylinderGeometry(0.5, 0.5, 1, 8));
    // 薄板/贴花：平面单位方块，用 scale 贴到面（警示条、面板缝、格栅叶片），1 个三角面组。
    this.geometry.set('panel', new THREE.PlaneGeometry(1, 1));
    this.geometry.set('cone', new THREE.CylinderGeometry(0.06, 0.5, 1, 12));
    this.geometry.set('hex', new THREE.CylinderGeometry(0.5, 0.5, 1, 6));
    this.geometry.set('dome', new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2));
    this.geometry.set('ring', new THREE.TorusGeometry(0.5, 0.025, 6, 32));
    this.geometry.set('rock', new THREE.IcosahedronGeometry(0.5, 0));
    this.geometry.set('crystal', new THREE.CylinderGeometry(0, 0.5, 1, 5));
    const blade = new THREE.Shape();
    blade.moveTo(-0.025, 0); blade.lineTo(-0.058, 0.26); blade.lineTo(-0.035, 0.5);
    blade.lineTo(0.009, 0.56); blade.lineTo(0.026, 0.21); blade.lineTo(0.026, 0); blade.closePath();
    const bladeGeometry = new THREE.ExtrudeGeometry(blade, { depth: 0.018, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.004, bevelSegments: 1, steps: 1 });
    this.geometry.set('blade', bladeGeometry);
  }

  /** 材质池键 → 共享材质。所有 finish 都从 `IndustrialSurfaces` 取，不在模型里写色值。 */
  private bindSurfaces() {
    for (const finish of Object.keys(SURFACE_KEY) as Finish[]) this.material.set(finish, this.surfaces.get(SURFACE_KEY[finish]));
  }

  private registerRotation(object: THREE.Object3D, axis: Rotation['axis'], speed: number) {
    object.userData.industrialRotation = { axis, speed };
    this.rotations.push({ object, axis, speed });
  }

  private cached(key: string): THREE.Group | undefined {
    const template = this.templates.get(key);
    if (!template) return;
    const group = template.clone(true);
    group.traverse((object) => {
      const rotation = object.userData.industrialRotation as Omit<Rotation, 'object'> | undefined;
      if (rotation) this.rotations.push({ object, ...rotation });
    });
    this.detachIndependentMaterials(group);
    return group;
  }

  /**
   * 逐实例改色的节点（运输机器人车顶货箱）各拿一份材质。
   *
   * `Group.clone(true)` 共享材质对象，所以「上色」等于「给同型号所有单位 + 模板一起改色」。
   * 模板与每个实例都必须各持一份：模板持共享铜色（未被污染），实例才能安全地按物品色写入。
   */
  private detachIndependentMaterials(group: THREE.Group) {
    group.traverse((object) => {
      if (object.userData.independentMaterial && object instanceof THREE.Mesh) {
        object.material = (object.material as THREE.Material).clone();
      }
    });
  }

  private remember(key: string, group: THREE.Group): THREE.Group {
    // Three clones object transforms but shares immutable geometry and materials.
    // Snapshot refreshes allocate no vertex buffers and retain the original rotor pose.
    const template = group.clone(true);
    this.detachIndependentMaterials(template);
    this.templates.set(key, template);
    // 首次实例同样要脱离模板材质，否则它的上色会顺着模板传染给后面每一个实例。
    this.detachIndependentMaterials(group);
    return group;
  }

  private part(parent: THREE.Object3D, shape: string, finish: string, size: [number, number, number], position: [number, number, number], rotation?: [number, number, number]) {
    const mesh = new THREE.Mesh(this.geometry.get(shape)!, this.material.get(finish)!);
    mesh.scale.set(...size); mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
    return mesh;
  }

  private box(parent: THREE.Object3D, finish: Finish, size: [number, number, number], position: [number, number, number], rotation?: [number, number, number]) {
    return this.part(parent, 'box', finish, size, position, rotation);
  }

  private pipe(parent: THREE.Object3D, finish: Finish, a: [number, number, number], b: [number, number, number], radius = 0.018) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), d = to.clone().sub(from);
    const mesh = this.part(parent, 'tube', finish, [radius * 2, d.length(), radius * 2], [0, 0, 0]);
    mesh.position.copy(from.add(to).multiplyScalar(0.5)); mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    return mesh;
  }

  /**
   * 薄贴花（警示条纹、面板缝、铭牌）：一个双面平面片，贴在建筑表面外 2mm。
   * `face` 是朝向（+z 默认）；不投影阴影，静态合批后按材质并入 1 个绘制调用。
   */
  private decal(parent: THREE.Object3D, finish: Finish, size: [number, number], position: [number, number, number], rotation?: [number, number, number]) {
    const mesh = new THREE.Mesh(this.geometry.get('panel')!, this.material.get(finish)!);
    mesh.scale.set(size[0], size[1], 1); mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = false; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** 外露管线：贴着一面墙走一段，再拐个弯（用两段 tube，读成工业管道而不是装饰线）。 */
  private conduit(parent: THREE.Object3D, finish: Finish, start: [number, number, number], corner: [number, number, number], end: [number, number, number], radius = 0.012) {
    this.pipe(parent, finish, start, corner, radius);
    this.pipe(parent, finish, corner, end, radius);
    this.box(parent, 'graphite', [radius * 4.2, radius * 4.2, radius * 4.2], corner);
  }

  /** 螺栓圈：沿半径均布的 6 个小六角头（每个 12 面，6 个 = 72 面）。 */
  private bolts(parent: THREE.Object3D, radius: number, y: number, count = 6, finish: Finish = 'alloy', scale = 0.016) {
    for (let i = 0; i < count; i++) {
      const a = i * Math.PI * 2 / count;
      this.part(parent, 'hex', finish, [scale, scale * .6, scale], [Math.cos(a) * radius, y, Math.sin(a) * radius]);
    }
  }

  /** 顶部设备：短天线 + 小碟（基站/研究站的识别件，俯视也有轮廓层次）。 */
  private antenna(group: THREE.Group, x: number, z: number, height: number, light: Finish) {
    this.pipe(group, 'alloy', [x, 0.1, z], [x, height, z], 0.01);
    this.part(group, 'cone', 'alloy', [0.16, 0.06, 0.16], [x, height, z], [Math.PI * 0.12, 0, 0]);
    this.box(group, light, [0.026, 0.026, 0.026], [x, height + 0.05, z]);
  }

  private ring(parent: THREE.Object3D, finish: Finish, radius: number, y: number, x = 0, z = 0) {
    return this.part(parent, 'ring', finish, [radius * 2, radius * 2, radius * 2], [x, y, z], [Math.PI / 2, 0, 0]);
  }

  private foundation(group: THREE.Group, finish: Finish) {
    // Shallow inset deck with separate structural feet, not an opaque tile-sized plinth.
    this.box(group, 'alloy', [0.86, 0.055, 0.82], [0, 0.045, 0]);
    this.box(group, 'graphite', [0.72, 0.035, 0.7], [0, 0.087, 0]);
    for (const x of [-0.36, 0.36]) for (const z of [-0.34, 0.34]) {
      this.box(group, 'ceramic', [0.15, 0.105, 0.15], [x, 0.065, z]);
      this.box(group, finish, [0.07, 0.012, 0.018], [x, 0.122, z + 0.038]);
    }
    for (const x of [-0.4, 0.4]) this.box(group, 'copper', [0.014, 0.012, 0.38], [x, 0.079, 0]);
  }

  private vents(group: THREE.Group, x: number, y: number, z: number, count = 6) {
    this.box(group, 'graphite', [0.21, 0.025, 0.3], [x, y, z]);
    for (let i = 0; i < count; i++) this.box(group, 'alloy', [0.19, 0.035, 0.016], [x, y + 0.014, z - 0.12 + i * 0.24 / (count - 1)]);
  }

  private tank(group: THREE.Group, x: number, z: number, y: number, height: number, radius: number, finish: Finish = 'ceramic') {
    this.part(group, 'cylinder', finish, [radius * 2, height, radius * 2], [x, y + height / 2, z]);
    this.part(group, 'dome', finish, [radius * 2, radius * 1.1, radius * 2], [x, y + height, z]);
    this.ring(group, 'alloy', radius * 1.03, y + 0.05, x, z);
    this.ring(group, 'copper', radius * 1.025, y + height * 0.7, x, z);
  }

  private turbine(group: THREE.Group, light: Finish) {
    this.part(group, 'cylinder', 'alloy', [0.27, 0.14, 0.27], [0, 0.16, 0]);
    this.part(group, 'cone', 'ceramic', [0.17, 1.18, 0.17], [0, 0.79, 0]);
    this.box(group, 'graphite', [0.17, 0.13, 0.3], [0, 1.38, 0.005]);
    this.box(group, 'ceramic', [0.18, 0.1, 0.26], [0, 1.435, 0]);
    this.box(group, light, [0.05, 0.025, 0.04], [0, 1.5, -0.08]);
    const rotor = new THREE.Group(); rotor.position.set(0, 1.38, 0.175); rotor.scale.setScalar(0.84); group.add(rotor);
    this.part(rotor, 'cylinder', 'alloy', [0.12, 0.09, 0.12], [0, 0, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Group(); blade.rotation.z = i * Math.PI * 2 / 3; rotor.add(blade);
      this.part(blade, 'blade', 'ceramic', [1, 1, 1], [0, 0.045, 0.01]);
      this.box(blade, 'copper', [0.028, 0.085, 0.025], [-0.008, 0.48, 0.019], [0, 0, 0.03]);
    }
    this.registerRotation(rotor, 'z', 1.25);
    this.box(group, 'ceramic', [0.2, 0.19, 0.19], [0.24, 0.19, -0.2]);
    this.pipe(group, 'copper', [0.06, 0.13, 0], [0.24, 0.13, -0.2], 0.019);
  }

  /** 采矿机：双塔架 + 横梁 + 钻头，加上外露液压管、警示条与尾部料斗。 */
  private miner(group: THREE.Group, light: Finish) {
    this.box(group, 'graphite', [0.58, 0.16, 0.6], [0, 0.19, 0]);
    this.box(group, 'plate', [0.5, 0.02, 0.52], [0, 0.276, 0.01]);
    for (const x of [-0.27, 0.27]) {
      this.box(group, 'ceramic', [0.14, 0.4, 0.45], [x, 0.35, -0.05]);
      this.box(group, 'copper', [0.16, 0.075, 0.3], [x, 0.44, -0.05]);
      // 液压杆：两根细管沿塔架外侧斜拉。
      this.pipe(group, 'alloy', [x, 0.3, 0.08], [x, 0.77, -0.14], 0.025);
      this.pipe(group, 'copper', [x + Math.sign(x) * 0.08, 0.22, -0.12], [x + Math.sign(x) * 0.08, 0.52, -0.12], 0.009);
      this.box(group, light, [0.025, 0.13, 0.025], [x + Math.sign(x) * 0.074, 0.37, 0.05]);
      for (let i = 0; i < 3; i++) this.part(group, 'hex', 'alloy', [0.016, 0.012, 0.016], [x, 0.55, -0.2 + i * 0.16]);
    }
    // 横梁：警示条纹贴花 + 顶面散热片。
    this.box(group, 'ceramic', [0.69, 0.15, 0.24], [0, 0.8, -0.15]);
    this.decal(group, 'hazard', [0.5, 0.055], [0, 0.8, -0.028]);
    for (let i = 0; i < 5; i++) this.box(group, 'alloy', [0.5, 0.03, 0.012], [0, 0.882, -0.23 + i * 0.04]);
    this.part(group, 'cylinder', 'copper', [0.27, 0.16, 0.27], [0, 0.77, 0.03], [Math.PI / 2, 0, 0]);
    const drill = new THREE.Group(); drill.position.set(0, 0.39, 0.2); group.add(drill);
    this.part(drill, 'cone', 'alloy', [0.23, 0.43, 0.23], [0, 0, 0], [Math.PI, 0, 0]);
    for (let i = 0; i < 7; i++) {
      const t = i / 7;
      this.part(drill, 'hex', i % 2 ? 'graphite' : 'copper', [0.07 + t * 0.22, 0.035, 0.07 + t * 0.22], [0, -0.19 + t * 0.37, 0], [0, i * 0.5, 0]);
    }
    this.registerRotation(drill, 'y', 2.2);
    this.vents(group, 0, 0.53, -0.2);
    // 尾部料斗：石墨箱 + 合金边框 + 琥珀料位灯。
    this.box(group, 'graphite', [0.22, 0.16, 0.16], [0, 0.33, -0.28]);
    this.box(group, 'alloy', [0.24, 0.02, 0.18], [0, 0.41, -0.28]);
    this.box(group, light, [0.1, 0.018, 0.012], [0, 0.3, -0.2]);
  }

  /** 电弧熔炉：六角炉体 + 铜芯 + 外露炉排 + 排气烟囱，正面炉门带警示条。 */
  private furnace(group: THREE.Group, light: Finish) {
    this.part(group, 'hex', 'graphite', [0.7, 0.45, 0.65], [0, 0.34, 0]);
    this.part(group, 'hex', 'alloy', [0.72, 0.04, 0.67], [0, 0.17, 0]);
    this.part(group, 'cylinder', 'copper', [0.4, 0.5, 0.4], [0, 0.49, -0.04]);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      this.box(group, 'ceramic', [0.075, 0.37, 0.1], [Math.cos(a) * 0.255, 0.46, Math.sin(a) * 0.255 - 0.04], [0, -a, 0]);
      this.box(group, 'orange', [0.032, 0.25, 0.025], [Math.cos(a) * 0.208, 0.47, Math.sin(a) * 0.208 - 0.04], [0, -a, 0]);
      // 每根炉排外侧一圈螺栓。
      this.part(group, 'hex', 'alloy', [0.014, 0.01, 0.014], [Math.cos(a) * 0.3, 0.62, Math.sin(a) * 0.3 - 0.04]);
    }
    this.ring(group, 'alloy', 0.245, 0.7, 0, -0.04);
    this.bolts(group, 0.2, 0.72, 6);
    this.part(group, 'cylinder', 'graphite', [0.3, 0.16, 0.3], [0, 0.78, -0.04]);
    this.ring(group, 'orange', 0.11, 0.865, 0, -0.04);
    // 炉门：石墨框 + 琥珀熔口 + 两侧警示条 + 门闩。
    this.box(group, 'graphite', [0.25, 0.18, 0.23], [0, 0.19, 0.3]);
    this.box(group, 'orange', [0.16, 0.08, 0.017], [0, 0.235, 0.42]);
    for (const x of [-0.135, 0.135]) this.decal(group, 'hazard', [0.035, 0.15], [x, 0.2, 0.42]);
    this.box(group, 'alloy', [0.19, 0.02, 0.02], [0, 0.31, 0.42]);
    // 排气烟囱：合金筒 + 两道箍 + 顶部黑烟口。
    this.tank(group, 0.29, -0.27, 0.1, 0.36, 0.068, 'alloy');
    this.pipe(group, 'copper', [0.29, 0.46, -0.27], [0.12, 0.46, -0.15], 0.017);
    this.box(group, light, [0.06, 0.025, 0.04], [-0.3, 0.22, 0.31]);
    this.pipe(group, 'alloy', [-0.24, 0.6, -0.2], [-0.24, 1.02, -0.2], 0.035);
    this.ring(group, 'graphite', 0.04, 0.86, -0.24, -0.2);
    this.ring(group, 'copper', 0.04, 0.96, -0.24, -0.2);
  }

  private factory(group: THREE.Group, light: Finish) {
    this.box(group, 'graphite', [0.7, 0.34, 0.65], [0, 0.28, 0]);
    this.box(group, 'ceramic', [0.73, 0.13, 0.68], [0, 0.5, 0]);
    for (const x of [-0.28, 0.28]) {
      this.box(group, 'ceramic', [0.11, 0.37, 0.7], [x, 0.3, 0]);
      this.box(group, 'copper', [0.12, 0.045, 0.72], [x, 0.42, 0]);
    }
    this.box(group, 'glass', [0.37, 0.12, 0.025], [0, 0.39, 0.334]);
    this.box(group, light, [0.31, 0.014, 0.026], [0, 0.33, 0.335]);
    this.box(group, 'graphite', [0.24, 0.19, 0.07], [0, 0.2, 0.37]);
    this.vents(group, -0.19, 0.58, -0.02);
    this.tank(group, 0.19, -0.14, 0.57, 0.17, 0.1);
    const arm = new THREE.Group(); arm.position.set(0.1, 0.61, 0.2); group.add(arm);
    this.part(arm, 'cylinder', 'alloy', [0.11, 0.09, 0.11], [0, 0, 0]);
    this.box(arm, 'copper', [0.05, 0.23, 0.05], [0, 0.14, 0]);
    this.box(arm, 'ceramic', [0.26, 0.05, 0.06], [0.095, 0.25, 0]);
    this.box(arm, 'graphite', [0.05, 0.09, 0.08], [0.2, 0.2, 0]);
    this.registerRotation(arm, 'y', 0.45);
    this.pipe(group, 'copper', [-0.37, 0.13, -0.16], [-0.37, 0.44, -0.16], 0.022);
  }

  /** 矩阵研究站：合金底座 + 玻璃反应柱 + 四层陶瓷环 + 顶部扫描臂，外加数据塔与散热管。 */
  private laboratory(group: THREE.Group, light: Finish) {
    this.part(group, 'hex', 'alloy', [0.75, 0.12, 0.75], [0, 0.17, 0]);
    this.part(group, 'hex', 'graphite', [0.78, 0.05, 0.78], [0, 0.1, 0]);
    this.part(group, 'cylinder', 'glass', [0.4, 0.76, 0.4], [0, 0.59, 0]);
    for (const y of [0.3, 0.52, 0.74, 0.96]) {
      this.part(group, 'hex', 'ceramic', [0.63, 0.055, 0.63], [0, y, 0]);
      this.ring(group, light, 0.245, y - 0.038);
      this.bolts(group, 0.29, y + 0.03, 4, 'alloy', 0.014);
    }
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      this.pipe(group, 'ceramic', [Math.cos(a) * 0.27, 0.2, Math.sin(a) * 0.27], [Math.cos(a) * 0.27, 1.02, Math.sin(a) * 0.27], 0.033);
    }
    this.part(group, 'dome', 'ceramic', [0.49, 0.3, 0.49], [0, 1.015, 0]);
    const scanner = new THREE.Group(); scanner.position.y = 1.13; group.add(scanner);
    this.box(scanner, 'graphite', [0.48, 0.027, 0.055], [0, 0.08, 0]);
    this.box(scanner, light, [0.07, 0.04, 0.07], [0.23, 0.08, 0]);
    this.pipe(scanner, 'alloy', [0, -0.03, 0], [0, 0.13, 0], 0.015);
    this.registerRotation(scanner, 'y', 0.6);
    // 侧挂数据塔：石墨机柜 + 发光屏幕 + 线槽；对角再挂一组散热管。
    this.box(group, 'graphite', [0.12, 0.34, 0.16], [0.3, 0.37, 0.24]);
    this.decal(group, light, [0.08, 0.16], [0.361, 0.4, 0.24], [0, Math.PI / 2, 0]);
    this.conduit(group, 'alloy', [0.3, 0.2, 0.16], [0.3, 0.2, 0.1], [0.24, 0.24, 0.05], 0.01);
    for (let i = 0; i < 3; i++) this.pipe(group, 'copper', [-0.3 - i * 0.02, 0.2, -0.22], [-0.3 - i * 0.02, 0.86, -0.22], 0.009);
    this.decal(group, 'hazard', [0.18, 0.04], [0, 0.135, 0.34], [0, 0, 0]);
  }

  /** 物流站：六棱塔身 + 六面装卸口 + 顶部停机坪，加检修梯、线缆槽与警示环。 */
  private logistics(group: THREE.Group, light: Finish) {
    this.part(group, 'hex', 'graphite', [0.7, 1.03, 0.65], [0, 0.62, 0]);
    this.part(group, 'hex', 'ceramic', [0.73, 0.12, 0.68], [0, 1.17, 0]);
    this.part(group, 'hex', 'alloy', [0.73, 0.1, 0.68], [0, 0.21, 0]);
    this.part(group, 'hex', 'plate', [0.6, 0.02, 0.55], [0, 1.235, 0]);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      this.box(group, 'ceramic', [0.12, 0.8, 0.095], [Math.cos(a) * 0.295, 0.66, Math.sin(a) * 0.295], [0, -a, 0]);
      this.box(group, light, [0.025, 0.6, 0.1], [Math.cos(a) * 0.3, 0.66, Math.sin(a) * 0.3], [0, -a, 0]);
      // 装卸口：每面一块石墨挡板 + 一条警示条。
      this.box(group, 'graphite', [0.1, 0.16, 0.02], [Math.cos(a) * 0.34, 0.42, Math.sin(a) * 0.34], [0, -a, 0]);
      this.decal(group, 'hazard', [0.08, 0.025], [Math.cos(a) * 0.352, 0.52, Math.sin(a) * 0.352], [0, -a + Math.PI / 2, 0]);
    }
    for (const y of [0.39, 0.68, 0.95]) this.ring(group, 'copper', 0.35, y);
    // 检修梯：两根竖管 + 六根横档（贴在 +X 面）。
    for (const z of [-0.04, 0.04]) this.pipe(group, 'alloy', [0.35, 0.25, z], [0.35, 1.1, z], 0.007);
    for (let i = 0; i < 6; i++) this.box(group, 'alloy', [0.01, 0.008, 0.09], [0.35, 0.3 + i * 0.14, 0]);
    this.part(group, 'cylinder', 'graphite', [0.46, 0.06, 0.46], [0, 1.26, 0]);
    this.ring(group, light, 0.18, 1.295);
    this.bolts(group, 0.21, 1.29, 6, 'alloy', 0.013);
    for (const side of [-1, 1]) {
      this.box(group, 'ceramic', [0.25, 0.05, 0.27], [side * 0.35, 0.42, 0.16]);
      this.box(group, light, [0.17, 0.012, 0.015], [side * 0.35, 0.455, 0.28]);
    }
    this.pipe(group, 'alloy', [0.15, 1.25, 0.1], [0.15, 1.65, 0.1], 0.012);
    this.box(group, 'orange', [0.027, 0.035, 0.027], [0.15, 1.67, 0.1]);
  }

  /** 仓储：箱体堆叠 + 门板缝 + 铜导轨；液体罐：双罐 + 连通管 + 液位灯 + 顶部人孔。 */
  private storage(group: THREE.Group, light: Finish, liquid: boolean) {
    if (liquid) {
      for (const x of [-0.2, 0.2]) {
        this.tank(group, x, 0, 0.11, 0.55, 0.17);
        this.part(group, 'cylinder', 'graphite', [0.06, 0.03, 0.06], [x, 0.69, 0]);
        this.bolts(group, 0.19, 0.13, 6, 'alloy', 0.013);
      }
      this.pipe(group, 'copper', [-0.2, 0.16, 0.2], [0.2, 0.16, 0.2], 0.024);
      this.pipe(group, 'alloy', [-0.2, 0.5, 0.18], [0, 0.62, 0.18], 0.014);
      this.pipe(group, 'alloy', [0, 0.62, 0.18], [0.2, 0.5, 0.18], 0.014);
      this.box(group, light, [0.035, 0.22, 0.016], [0.2, 0.4, 0.174]);
      this.decal(group, 'hazard', [0.16, 0.03], [0, 0.12, 0.2]);
    } else {
      for (let level = 0; level < 2; level++) for (const x of [-0.19, 0.19]) {
        this.box(group, level ? 'ceramic' : 'alloy', [0.34, 0.21, 0.58], [x, 0.24 + level * 0.23, 0]);
        for (const z of [-0.2, 0.2]) this.box(group, 'graphite', [0.355, 0.235, 0.032], [x, 0.24 + level * 0.23, z]);
        // 门板：正面一条面板缝 + 把手 + 铜导轨。
        this.decal(group, 'graphite', [0.02, 0.16], [x + 0.06, 0.24 + level * 0.23, 0.292]);
        this.box(group, 'alloy', [0.06, 0.012, 0.012], [x + 0.06, 0.2 + level * 0.23, 0.3]);
        this.box(group, 'copper', [0.19, 0.04, 0.018], [x, 0.26 + level * 0.23, 0.3]);
      }
      this.box(group, 'graphite', [0.78, 0.04, 0.03], [0, 0.46, -0.295]);
      this.box(group, light, [0.09, 0.04, 0.025], [0, 0.14, 0.34]);
      this.decal(group, 'hazard', [0.22, 0.03], [0, 0.36, 0.3]);
    }
  }

  private distributor(group: THREE.Group, light: Finish) {
    this.part(group, 'cylinder', 'graphite', [0.67, 0.09, 0.67], [0, 0.045, 0]);
    this.part(group, 'cylinder', 'alloy', [0.61, 0.035, 0.61], [0, 0.105, 0]);
    this.ring(group, light, 0.245, 0.128);
    for (const x of [-0.3, 0.3]) {
      this.box(group, 'ceramic', [0.1, 0.19, 0.39], [x, 0.14, 0]);
      this.box(group, light, [0.012, 0.04, 0.23], [x, 0.242, 0]);
    }
    this.box(group, 'ceramic', [0.4, 0.26, 0.13], [0, 0.19, -0.28]);
    this.box(group, 'copper', [0.26, 0.06, 0.025], [0, 0.25, -0.2]);
    this.pipe(group, 'alloy', [0.22, 0.21, -0.26], [0.22, 0.55, -0.26], 0.012);
    this.box(group, light, [0.035, 0.04, 0.035], [0.22, 0.56, -0.26]);
  }

  /**
   * 发电（solar = 光伏板 / 否则电塔、火电、蓄电共用塔形）。
   * 塔形加底座检修门、警示条、四向绝缘子与顶部电晕环——俯视时能一眼和「蓄电罐」分开。
   */
  private power(group: THREE.Group, light: Finish, solar: boolean) {
    if (solar) {
      this.pipe(group, 'alloy', [0, 0.09, 0], [0, 0.42, 0], 0.05);
      this.part(group, 'hex', 'graphite', [0.24, 0.06, 0.24], [0, 0.1, 0]);
      const array = new THREE.Group(); array.position.y = 0.45; array.rotation.x = -0.24; group.add(array);
      this.box(array, 'alloy', [0.83, 0.035, 0.73], [0, 0, 0]);
      for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) {
        this.box(array, 'glass', [0.185, 0.012, 0.157], [-0.3 + x * 0.2, 0.024, -0.255 + z * 0.17]);
        this.box(array, 'alloy', [0.002, 0.014, 0.15], [-0.3 + x * 0.2, 0.033, -0.255 + z * 0.17]);
      }
      this.decal(array, 'hazard', [0.7, 0.03], [0, 0.03, 0.34]);
      this.pipe(group, 'copper', [0.34, 0.24, -0.3], [0.34, 0.12, -0.34], 0.012);
      return;
    }
    this.part(group, 'hex', 'graphite', [0.46, 0.07, 0.46], [0, 0.1, 0]);
    this.part(group, 'hex', 'ceramic', [0.42, 0.19, 0.42], [0, 0.21, 0]);
    this.part(group, 'cone', 'alloy', [0.2, 0.74, 0.2], [0, 0.63, 0.1]);
    for (const y of [0.56, 0.66, 0.76, 0.86]) this.part(group, 'cylinder', 'copper', [0.28, 0.035, 0.28], [0, y, 0.1]);
    this.part(group, 'cylinder', 'ceramic', [0.34, 0.08, 0.34], [0, 0.96, 0.1]);
    this.ring(group, light, 0.16, 1.015, 0, 0.1);
    this.pipe(group, 'alloy', [0, 1, 0.1], [0, 1.18, 0.1], 0.016);
    this.part(group, 'hex', light, [0.07, 0.07, 0.07], [0, 1.19, 0.1]);
    // 底座检修门 + 警示条 + 四向绝缘子串。
    this.box(group, 'graphite', [0.16, 0.13, 0.03], [0, 0.22, 0.32]);
    this.decal(group, 'hazard', [0.3, 0.035], [0, 0.14, 0.335]);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      this.pipe(group, 'alloy', [Math.cos(a) * 0.2, 0.3, Math.sin(a) * 0.2], [Math.cos(a) * 0.34, 0.36, Math.sin(a) * 0.34], 0.008);
      this.ring(group, 'graphite', 0.022, 0.36, Math.cos(a) * 0.34, Math.sin(a) * 0.34);
    }
  }

  private conveyor(group: THREE.Group, light: Finish) {
    this.box(group, 'graphite', [0.53, 0.085, 0.89], [0, 0.16, 0]);
    for (const x of [-0.28, 0.28]) {
      this.box(group, 'ceramic', [0.055, 0.1, 0.91], [x, 0.2, 0]);
      this.box(group, 'copper', [0.059, 0.025, 0.81], [x, 0.258, 0]);
    }
    for (let i = 0; i < 10; i++) this.box(group, 'alloy', [0.48, 0.018, 0.036], [0, 0.217, -0.38 + i * 0.085]);
    this.box(group, light, [0.15, 0.018, 0.045], [0, 0.231, 0.33]);
    for (const x of [-0.22, 0.22]) for (const z of [-0.33, 0.33]) this.box(group, 'graphite', [0.075, 0.15, 0.09], [x, 0.075, z]);
  }

  private splitter(group: THREE.Group, light: Finish) {
    // Low four-port hub; the surface conveyor network provides the configured
    // input/output branches beneath the central housing.
    this.box(group, 'graphite', [.48, .13, .48], [0, .19, 0]);
    for (const rotation of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const port = new THREE.Group(); port.rotation.y = rotation; group.add(port);
      for (const side of [-1, 1]) this.box(port, 'ceramic', [.06, .15, .24], [side * .23, .25, .31]);
      this.box(port, 'copper', [.48, .055, .08], [0, .35, .4]);
    }
    this.part(group, 'cylinder', 'ceramic', [.38, .14, .38], [0, .4, 0]);
    this.part(group, 'cylinder', 'graphite', [.25, .055, .25], [0, .49, 0]);
    this.ring(group, light, .13, .525);
    this.box(group, 'alloy', [.07, .018, .22], [0, .53, 0]);
    this.box(group, 'alloy', [.22, .018, .07], [0, .53, 0]);
  }

  private trafficMonitor(group: THREE.Group, light: Finish) {
    this.box(group, 'graphite', [.15, .5, .15], [0, .38, 0]);
    this.box(group, 'ceramic', [.63, .43, .17], [0, .75, 0]);
    this.box(group, 'glass', [.51, .3, .02], [0, .75, .1]);
    for (let i = 0; i < 5; i++) this.box(group, light, [.035, .05 + i * .035, .024], [-.18 + i * .09, .68 + i * .0175, .118]);
    this.part(group, 'cylinder', 'copper', [.08, .16, .08], [.24, 1.02, 0]);
    this.part(group, 'dome', light, [.11, .09, .11], [.24, 1.1, 0]);
  }

  private fractionator(group: THREE.Group, light: Finish) {
    this.tank(group, -.17, -.12, .11, .76, .18);
    this.tank(group, .24, -.1, .11, .43, .105, 'alloy');
    for (const y of [.3, .43, .56, .69]) this.ring(group, 'copper', .19, y, -.17, -.12);
    this.pipe(group, 'alloy', [-.42, .23, 0], [-.17, .23, -.12], .045);
    this.pipe(group, 'alloy', [-.17, .73, -.12], [.24, .73, -.1], .035);
    this.pipe(group, 'alloy', [.24, .73, -.1], [.24, .3, -.1], .035);
    this.pipe(group, 'copper', [.24, .25, -.1], [.43, .25, 0], .045);
    this.pipe(group, 'alloy', [-.17, .19, -.12], [0, .19, .43], .04);
    this.box(group, 'graphite', [.2, .28, .12], [.15, .28, .23]);
    this.box(group, light, [.12, .1, .012], [.15, .32, .298]);
    for (const z of [-.23, -.12, -.01]) this.pipe(group, 'graphite', [-.35, .16, z], [-.35, .84, z], .013);
  }

  private particleCollider(group: THREE.Group, light: Finish) {
    // Superconducting raceway, magnet housings and central collision chamber.
    this.ring(group, 'graphite', .35, .28);
    this.ring(group, 'alloy', .34, .34);
    this.ring(group, light, .31, .365);
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, x = Math.cos(angle) * .34, z = Math.sin(angle) * .34;
      this.box(group, 'ceramic', [.13, .17, .12], [x, .37, z], [0, -angle, 0]);
      this.box(group, 'copper', [.065, .018, .13], [x, .465, z], [0, -angle, 0]);
    }
    this.part(group, 'cylinder', 'graphite', [.25, .22, .25], [0, .27, 0]);
    this.part(group, 'dome', 'glass', [.25, .18, .25], [0, .4, 0]);
    this.ring(group, light, .13, .405);
    for (const side of [-1, 1]) {
      this.box(group, 'ceramic', [.19, .23, .22], [side * .3, .23, -.3]);
      this.vents(group, side * .3, .365, -.3, 4);
      this.pipe(group, 'alloy', [side * .3, .23, -.3], [side * .1, .23, 0], .022);
    }
  }

  private sprayCoater(group: THREE.Group, light: Finish) {
    this.box(group, 'graphite', [.91, .07, .42], [0, .17, 0]);
    for (const z of [-.24, .24]) {
      this.box(group, 'alloy', [.93, .065, .045], [0, .23, z]);
      this.box(group, 'ceramic', [.13, .5, .1], [0, .38, z]);
    }
    for (let i = 0; i < 9; i++) this.box(group, 'alloy', [.025, .012, .4], [-.38 + i * .095, .212, 0]);
    this.box(group, 'ceramic', [.22, .13, .61], [0, .67, 0]);
    for (const z of [-.14, 0, .14]) this.part(group, 'cone', 'copper', [.055, .09, .055], [0, .555, z], [Math.PI, 0, 0]);
    this.tank(group, .22, -.26, .11, .33, .1, 'glass');
    this.pipe(group, 'alloy', [.22, .4, -.26], [0, .67, -.22], .02);
    this.box(group, light, [.12, .035, .012], [0, .67, .312]);
  }

  /** 战场分析基站：六边形指挥基座 + 穹顶雷达 + 两侧设备翼 + 天线阵，俯视中远景读得出「指挥中枢」。 */
  private headquarters(group: THREE.Group, light: Finish, armor: Finish) {
    // 基座：深色承重裙 + 陶瓷主甲板 + 一圈合金收边（三层轮廓，不再是一块白饼）。
    this.part(group, 'hex', 'graphite', [0.83, 0.24, 0.79], [0, 0.22, 0]);
    this.part(group, 'hex', 'alloy', [0.8, 0.05, 0.76], [0, 0.36, 0]);
    this.part(group, 'hex', armor, [0.76, 0.12, 0.72], [0, 0.44, 0]);
    this.part(group, 'hex', 'plate', [0.62, 0.03, 0.58], [0, 0.51, 0]);
    // 甲板面板缝：三条细贴花把大白面切开（每块 2 个三角面）。
    for (const z of [-0.2, 0, 0.2]) this.decal(group, 'graphite', [0.52, 0.012], [0, 0.527, z], [-Math.PI / 2, 0, 0]);
    // 警示条纹：正面楼梯口两侧各一条（琥珀点缀，只占很小面积）。
    for (const x of [-0.12, 0.12]) this.decal(group, 'hazard', [0.06, 0.16], [x, 0.2, 0.395], [-0.28, 0, 0]);
    // 中央指挥舱：玻璃环 + 穹顶 + 穹顶肋条 + 顶部灯环。
    this.part(group, 'cylinder', 'glass', [0.43, 0.23, 0.43], [0, 0.63, -0.045]);
    this.ring(group, 'alloy', 0.235, 0.56, 0, -0.045);
    this.part(group, 'dome', armor, [0.49, 0.28, 0.49], [0, 0.745, -0.045]);
    this.ring(group, light, 0.22, 0.72, 0, -0.045);
    // 穹顶肋条：从穹顶基部到顶心各 1 根细管，贴着球面走（俯视是放射状，侧面是拱肋）。
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      this.pipe(group, 'alloy', [Math.cos(a) * 0.235, 0.755, Math.sin(a) * 0.235 - 0.045], [Math.cos(a) * 0.075, 0.995, Math.sin(a) * 0.075 - 0.045], 0.007);
    }
    this.part(group, 'cylinder', 'graphite', [0.07, 0.05, 0.07], [0, 1.0, -0.045]);
    // 两侧设备翼：装甲壳 + 通风格栅 + 螺栓排。
    for (const x of [-0.29, 0.29]) {
      this.box(group, armor, [0.17, 0.27, 0.47], [x, 0.36, 0.025]);
      this.box(group, 'alloy', [0.18, 0.02, 0.48], [x, 0.5, 0.025]);
      this.vents(group, x, 0.45, -0.035, 5);
      for (let i = 0; i < 4; i++) this.part(group, 'hex', 'alloy', [0.018, 0.012, 0.018], [x, 0.512, -0.15 + i * 0.1]);
      this.box(group, light, [0.02, 0.09, 0.02], [x + Math.sign(x) * 0.09, 0.4, 0.24]);
    }
    // 正面入口：门框 + 发光门缝 + 台阶。
    this.box(group, 'graphite', [0.25, 0.22, 0.1], [0, 0.28, 0.36]);
    this.box(group, light, [0.2, 0.02, 0.03], [0, 0.405, 0.419]);
    for (let i = 0; i < 3; i++) this.box(group, 'alloy', [0.26, 0.025, 0.055], [0, 0.16 - i * 0.021, 0.38 + i * 0.045]);
    // 后侧天线桅：管 + 横臂 + 三根振子。
    this.pipe(group, 'alloy', [0.21, 0.5, -0.24], [0.21, 1.12, -0.24], 0.012);
    this.box(group, 'alloy', [0.2, 0.023, 0.025], [0.21, 0.98, -0.24]);
    for (const dx of [-0.08, 0, 0.08]) this.pipe(group, 'alloy', [0.21 + dx, 0.9, -0.24], [0.21 + dx, 1.02, -0.24], 0.005);
    this.box(group, 'orange', [0.03, 0.04, 0.03], [0.21, 1.15, -0.24]);
    // 顶部设备：一台短天线 + 散热片，打破穹顶的纯圆轮廓。
    this.antenna(group, -0.2, -0.24, 0.95, light);
    for (let i = 0; i < 4; i++) this.box(group, 'alloy', [0.03, 0.09, 0.14], [-0.06 + i * 0.04, 0.55, -0.3], [0, 0, 0.06]);
  }

  private turret(group: THREE.Group, light: Finish, armor: Finish) {
    this.part(group, 'hex', 'alloy', [0.68, 0.17, 0.68], [0, 0.18, 0]);
    this.part(group, 'hex', 'plate', [0.7, 0.03, 0.7], [0, 0.095, 0]);
    this.part(group, 'cylinder', 'graphite', [0.4, 0.24, 0.4], [0, 0.36, 0]);
    this.bolts(group, 0.27, 0.28, 6, 'alloy', 0.014);
    this.box(group, armor, [0.43, 0.24, 0.4], [0, 0.52, 0]);
    // 炮塔侧裙：两条合金护板 + 警示条（俯视时把圆形塔身读成「武器站」）。
    for (const x of [-0.23, 0.23]) {
      this.box(group, 'alloy', [0.03, 0.16, 0.34], [x, 0.5, -0.02]);
      this.decal(group, 'hazard', [0.03, 0.3], [x * 1.08, 0.5, -0.02], [0, Math.PI / 2, 0]);
    }
    // 独立炮管组（C2 炮塔转向）：registerRotation 标记后 batchStatic 跳过整棵子树，
    // DynamicBatches 逐帧复制姿态；场景侧按最近敌对目标写 rotation.y（speed=0 不自动转）。
    const barrel = new THREE.Group();
    barrel.name = 'turret-barrel';
    barrel.position.set(0, 0.52, 0);
    group.add(barrel);
    for (const x of [-0.11, 0.11]) {
      this.pipe(barrel, 'alloy', [x, 0.02, 0.12], [x, 0.11, 0.51], 0.04);
      this.box(barrel, 'graphite', [0.1, 0.1, 0.12], [x, 0.1, 0.45], [-0.2, 0, 0]);
    }
    this.registerRotation(barrel, 'y', 0);
    this.box(group, light, [0.13, 0.03, 0.035], [0, 0.55, -0.215]);
  }

  /** 炼油厂：双精馏塔 + 连通管 + 检修平台，塔身加箍带、爬梯与警示环。 */
  private refinery(group: THREE.Group, light: Finish) {
    this.part(group, 'hex', 'graphite', [0.72, 0.08, 0.6], [0, 0.1, -0.04]);
    for (const [x, height] of [[-0.21, 0.85], [0.19, 0.6]]) {
      this.part(group, 'cylinder', 'alloy', [0.25, height, 0.25], [x, height / 2 + 0.13, -0.06]);
      for (let i = 0; i < 4; i++) {
        this.part(group, 'cylinder', 'copper', [0.27, 0.026, 0.27], [x, 0.2 + i * height / 4, -0.06]);
      }
      this.part(group, 'cone', 'ceramic', [0.25, 0.12, 0.25], [x, height + 0.19, -0.06]);
      this.pipe(group, 'copper', [x, 0.18, -0.06], [x, 0.18, 0.32], 0.028);
      this.box(group, light, [0.045, 0.025, 0.045], [x, height + 0.27, -0.06]);
      // 爬梯 + 平台护栏（每塔一侧，俯视是两条细线，侧面读得出「可检修」）。
      this.pipe(group, 'alloy', [x + 0.13, 0.18, -0.06], [x + 0.13, height + 0.1, -0.06], 0.006);
      for (let i = 0; i < 4; i++) this.box(group, 'alloy', [0.012, 0.006, 0.08], [x + 0.13, 0.28 + i * height / 5, -0.06]);
      this.box(group, 'graphite', [0.3, 0.018, 0.1], [x, 0.13 + height * 0.55, 0.06]);
    }
    this.pipe(group, 'alloy', [-0.21, 0.53, -0.06], [0.19, 0.53, -0.06], 0.04);
    this.box(group, 'graphite', [0.27, 0.19, 0.16], [0, 0.22, 0.24]);
    this.box(group, light, [0.14, 0.06, 0.012], [0, 0.26, 0.326]);
    this.decal(group, 'hazard', [0.2, 0.03], [0, 0.15, 0.32]);
  }

  building(type: string, width: number, depth: number, own: boolean): THREE.Group {
    const key = `building:${type}:${width}:${depth}:${own}`;
    const cached = this.cached(key); if (cached) return cached;
    // 现成 GLB（异步加载完才有）：直接用它，比例在 instantiateBuilding 里按占地归一化。
    const ready = instantiateBuilding(type, width, depth, own);
    if (ready) { this.batchStatic(ready); return this.remember(key, ready); }
    const group = new THREE.Group(); group.name = `industrial-${type}`;
    const light: Finish = own ? 'blue' : 'orange', armor: Finish = own ? 'ceramic' : 'hostile';
    // 分拣器（sorter-rig）与带子一样直接贴地，不铺方形地基。
    if (type !== 'foundation' && type !== 'splitter' && type !== 'logistics_distributor' && !/conveyor/.test(type) && !/sorter/.test(type)) this.foundation(group, light);
    if (type === 'foundation') {
      this.box(group, 'alloy', [0.98, 0.035, 0.98], [0, 0.012, 0]);
      for (const edge of [-1, 1]) {
        this.box(group, 'graphite', [0.96, 0.008, 0.018], [0, 0.034, edge * 0.46]);
        this.box(group, 'graphite', [0.018, 0.008, 0.96], [edge * 0.46, 0.034, 0]);
      }
    } else if (/conveyor/.test(type)) this.conveyor(group, light);
    else if (type === 'traffic_monitor') this.trafficMonitor(group, light);
    else if (type === 'splitter') this.splitter(group, light);
    else if (type === 'fractionator') this.fractionator(group, light);
    else if (type === 'miniature_particle_collider') this.particleCollider(group, light);
    else if (type === 'spray_coater') this.sprayCoater(group, light);
    // 分拣器由 `sorter-rig`（门控式，按真实端点伸展）统一实例化绘制，这里只留空组。
    else if (/sorter/.test(type)) { /* sorter-rig */ }
    else if (/wind/.test(type)) this.turbine(group, light);
    else if (type === 'oil_refinery') this.refinery(group, light);
    else if (/mining|miner|extractor|oil/.test(type)) this.miner(group, light);
    else if (/smelt|furnace|thermal/.test(type)) this.furnace(group, light);
    else if (/lab|research|matrix/.test(type)) this.laboratory(group, light);
    else if (type === 'logistics_distributor') this.distributor(group, light);
    else if (/logistics|launch|silo/.test(type)) this.logistics(group, light);
    else if (/storage|warehouse|depot|tank/.test(type)) this.storage(group, light, /tank|liquid/.test(type));
    else if (/solar|tesla|power|accumulator|energy|substation/.test(type)) this.power(group, light, /solar/.test(type));
    else if (/turret|missile|cannon|defense/.test(type)) this.turret(group, light, armor);
    else if (/base|hub|command|core/.test(type)) this.headquarters(group, light, armor);
    else this.factory(group, light);
    group.scale.set(width, Math.max(0.8, Math.min(width, depth) * 0.72), depth);
    this.batchStatic(group);
    return this.remember(key, group);
  }

  unit(type: string, faction: UnitFaction): THREE.Group {
    const key = `unit:${type}:${faction}`;
    const cached = this.cached(key); if (cached) return cached;
    const ready = instantiateUnit(type, faction);
    if (ready) { this.batchStatic(ready); return this.remember(key, ready); }
    const group = new THREE.Group(); group.name = `industrial-unit-${type}`;
    const { armor, light } = UNIT_FINISH[faction];
    if (type === 'logistics_bot') {
      this.box(group, armor, [0.4, 0.16, 0.3], [0, 0.2, 0]);
      this.box(group, 'glass', [0.23, 0.065, 0.025], [0, 0.235, 0.16]);
      for (const x of [-0.26, 0.26]) for (const z of [-0.2, 0.2]) {
        this.pipe(group, 'alloy', [0, 0.2, 0], [x, 0.21, z], 0.027);
        this.ring(group, 'graphite', 0.105, 0.21, x, z);
        const rotor = new THREE.Group(); rotor.position.set(x, 0.22, z); group.add(rotor);
        this.box(rotor, 'alloy', [0.18, 0.012, 0.025], [0, 0, 0]);
        this.registerRotation(rotor, 'y', 24);
        this.box(group, light, [0.045, 0.025, 0.045], [x, 0.19, z]);
      }
      for (const x of [-0.16, 0.16]) this.box(group, 'graphite', [0.025, 0.13, 0.19], [x, 0.055, 0]);
    } else if (type === 'transport_robot') {
      // 运输机器人（§4）：小型轮式底盘 + 青色灯带，车顶货箱有货才显示
      // （planet-three-scene 按 haul.cargo 上色/显隐，节点名 transport-robot-cargo）。
      for (const side of [-1, 1]) {
        this.box(group, 'graphite', [0.055, 0.12, 0.36], [side * 0.17, 0.1, 0]);
        for (const z of [-0.12, 0.12]) this.part(group, 'cylinder', 'rubber', [0.13, 0.06, 0.13], [side * 0.18, 0.065, z], [0, 0, Math.PI / 2]);
      }
      this.box(group, armor, [0.4, 0.1, 0.44], [0, 0.18, 0]);
      this.box(group, 'glass', [0.18, 0.05, 0.02], [0, 0.21, 0.225], [-0.16, 0, 0]);
      for (const x of [-0.15, 0.15]) this.box(group, light, [0.05, 0.03, 0.02], [x, 0.155, 0.225]);
      this.box(group, light, [0.34, 0.016, 0.02], [0, 0.24, -0.22]);
      this.pipe(group, 'alloy', [0.1, 0.24, -0.1], [0.1, 0.38, -0.1], 0.005);
    } else if (type === 'executor' || /mech|mecha/.test(type)) {
      // 重型机甲：双腿、装甲躯干、驾驶舱与肩部武器，和普通工人/士兵模型明确区分。
      for (const side of [-1, 1]) {
        this.box(group, 'graphite', [0.14, 0.26, 0.16], [side * 0.13, 0.16, 0]);
        this.box(group, armor, [0.12, 0.13, 0.13], [side * 0.13, 0.39, 0]);
        this.part(group, 'cylinder', 'alloy', [0.075, 0.11, 0.075], [side * 0.13, 0.02, 0], [0, 0, Math.PI / 2]);
      }
      this.box(group, armor, [0.42, 0.3, 0.28], [0, 0.42, 0]);
      this.box(group, 'glass', [0.24, 0.11, 0.035], [0, 0.52, 0.145], [-0.15, 0, 0]);
      this.part(group, 'cylinder', light, [0.11, 0.08, 0.11], [0, 0.69, 0], [Math.PI / 2, 0, 0]);
      for (const side of [-1, 1]) {
        this.box(group, armor, [0.13, 0.12, 0.2], [side * 0.3, 0.53, 0]);
        this.pipe(group, 'alloy', [side * 0.31, 0.54, 0.06], [side * 0.31, 0.54, 0.3], 0.024);
      }
    } else if (/ship|vessel|drone|fighter|space|fleet|transport/.test(type)) {
      this.box(group, 'graphite', [0.28, 0.13, 0.67], [0, 0.12, 0]);
      this.box(group, armor, [0.26, 0.16, 0.43], [0, 0.19, -0.05]);
      this.part(group, 'cone', armor, [0.26, 0.31, 0.18], [0, 0.16, 0.3], [Math.PI / 2, 0, 0]);
      this.box(group, 'glass', [0.18, 0.065, 0.15], [0, 0.28, 0.09], [0.2, 0, 0]);
      for (const side of [-1, 1]) {
        this.box(group, armor, [0.25, 0.045, 0.25], [side * 0.22, 0.12, -0.06], [0, side * 0.3, 0]);
        this.box(group, 'graphite', [0.115, 0.11, 0.34], [side * 0.27, 0.13, -0.15]);
        this.part(group, 'cylinder', 'alloy', [0.1, 0.1, 0.1], [side * 0.27, 0.13, -0.35], [Math.PI / 2, 0, 0]);
        this.part(group, 'cone', light, [0.075, 0.18, 0.075], [side * 0.27, 0.13, -0.46], [Math.PI / 2, 0, 0]);
        this.box(group, 'copper', [0.022, 0.025, 0.17], [side * 0.32, 0.18, -0.12]);
      }
    } else {
      for (const side of [-1, 1]) {
        this.box(group, 'rubber', [0.135, 0.15, 0.49], [side * 0.22, 0.105, 0]);
        for (let i = 0; i < 4; i++) this.part(group, 'cylinder', 'alloy', [0.09, 0.145, 0.09], [side * 0.225, 0.105, -0.17 + i * 0.113], [0, 0, Math.PI / 2]);
        this.box(group, armor, [0.15, 0.055, 0.51], [side * 0.22, 0.21, 0]);
      }
      this.box(group, 'graphite', [0.37, 0.15, 0.44], [0, 0.18, 0]);
      this.box(group, armor, [0.31, 0.16, 0.28], [0, 0.3, -0.045]);
      this.box(group, 'glass', [0.23, 0.075, 0.02], [0, 0.32, 0.106], [-0.12, 0, 0]);
      for (const x of [-0.14, 0.14]) this.box(group, light, [0.045, 0.038, 0.023], [x, 0.225, 0.234]);
      this.pipe(group, 'alloy', [0.1, 0.37, -0.1], [0.1, 0.58, -0.1], 0.005);
      if (/tank|combat|assault|gun|battle/.test(type)) this.pipe(group, 'alloy', [0, 0.36, 0.04], [0, 0.38, 0.37], 0.028);
      else this.box(group, 'copper', [0.2, 0.055, 0.1], [0, 0.4, -0.06]);
    }
    this.batchStatic(group);
    if (type === 'logistics_bot') {
      const cargo = this.box(group, 'copper', [0.22, 0.15, 0.19], [0, 0.035, 0]);
      cargo.name = 'logistics-bot-cargo';
      cargo.visible = false;
    }
    if (type === 'transport_robot') {
      // 车顶货箱：有货才显示，颜色由场景按 haul.cargo.item_id 写入物品配色。
      // 单独克隆一份材质（车顶要逐单位上色，不能写进共享的 copper 材质），
      // 也不能进 batchStatic（合并静态网格会吞掉需要独立改色/显隐的节点）。
      const cargo = this.box(group, 'copper', [0.3, 0.14, 0.3], [0, 0.33, 0]);
      cargo.name = 'transport-robot-cargo';
      cargo.material = (cargo.material as THREE.MeshStandardMaterial).clone();
      cargo.userData.independentMaterial = true;
      cargo.visible = false;
    }
    return this.remember(key, group);
  }

  /** 预加载现成 GLB 与 PBR 材质贴图（异步）。场景在构造后调用一次，
   * 完成后调 `reloadTemplates()` 让已建实体换成 GLB / PBR 材质。 */
  static preload(): Promise<void> {
    return Promise.all([preloadIndustrialGltf(), preloadIndustrialMaterials()]).then(() => undefined);
  }

  /** PBR 贴图就绪后调用（场景在 `preload()` 完成后统一调用）：换材质并丢模板缓存。 */
  upgradeSurfaces(): boolean {
    if (this.disposed || !this.surfaces.upgrade()) return false;
    this.material.clear();
    this.bindSurfaces();
    this.templates.clear();
    return true;
  }

  /** 现成 GLB 加载完成后调用：丢掉旧的模板缓存，让下一次 `building()/unit()` 用 GLB 重建。
   * 已经发出去的实例继续持有自己的几何/材质（dispose() 统一释放），这里只清模板表。 */
  reloadTemplates(): void {
    this.templates.clear();
  }

  resource(kind: string): THREE.Group {
    const assetKey = `resource:${kind}`;
    const cached = this.cached(assetKey); if (cached) return cached;
    const group = new THREE.Group(); group.name = `industrial-resource-${kind}`;
    const crystal = /crystal|silicon|titan|rare|optical|diamond/.test(kind);
    const color = /copper/.test(kind) ? 0xb16c40 : /coal|oil/.test(kind) ? 0x343f43 : /silicon|crystal/.test(kind) ? 0x82c6cf : /titan/.test(kind) ? 0xc4c3b5 : /stone/.test(kind) ? 0x8c9185 : 0x72949f;
    const key = `ore-${color}`;
    if (!this.material.has(key)) this.material.set(key, new THREE.MeshStandardMaterial({ color, roughness: crystal ? 0.28 : 0.84, metalness: crystal ? 0.42 : 0.27, flatShading: true }));
    // A deterministic irregular outcrop, with low rubble and faceted tilted mineral seams.
    for (let i = 0; i < 9; i++) {
      const a = i * 2.399963, spread = i === 0 ? 0 : 0.1 + (i % 3) * 0.09;
      const height = i === 0 ? 0.42 : 0.12 + ((i * 7) % 5) * 0.055;
      const width = i === 0 ? 0.3 : 0.12 + (i % 3) * 0.046;
      this.part(group, crystal ? 'crystal' : 'rock', key, [width, height, width * (0.7 + (i % 2) * 0.45)], [Math.cos(a) * spread, height * (crystal ? 0.43 : 0.31), Math.sin(a) * spread], [Math.sin(a) * 0.3, a, Math.cos(a) * 0.28]);
    }
    this.batchStatic(group);
    return this.remember(assetKey, group);
  }

  /** Merge static pieces by finish: detailed models cost a handful of draws, not one per bolt.
   * Animated groups stay independent so rotors/drills remain movable.
   */
  private batchStatic(group: THREE.Group) {
    const dynamic = new Set(this.rotations.map((rotation) => rotation.object));
    const batches = new Map<THREE.Material, { geometries: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
    const rootScale = group.scale.clone(); group.scale.setScalar(1); group.updateMatrixWorld(true);
    const collect = (object: THREE.Object3D) => {
      if (dynamic.has(object)) return;
      if (object instanceof THREE.Mesh) {
        const material = object.material as THREE.Material;
        let batch = batches.get(material);
        if (!batch) { batch = { geometries: [], meshes: [] }; batches.set(material, batch); }
        const geometry = object.geometry.clone(); geometry.applyMatrix4(object.matrixWorld);
        // Extruded and primitive geometries have matching position/normal/uv attributes.
        batch.geometries.push(geometry); batch.meshes.push(object);
      }
      for (const child of object.children) collect(child);
    };
    collect(group);
    for (const [material, batch] of batches) {
      // All geometry becomes non-indexed so mixed primitive types combine consistently.
      const normalized = batch.geometries.map((geometry) => geometry.index ? geometry.toNonIndexed() : geometry);
      const geometry = mergeGeometries(normalized, false);
      normalized.forEach((item) => item.dispose()); batch.geometries.forEach((item) => item.dispose());
      if (!geometry) continue;
      this.merged.add(geometry);
      const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true;
      batch.meshes.forEach((original) => original.removeFromParent()); group.add(mesh);
    }
    group.scale.copy(rootScale);
  }

  animate(_time: number, delta: number): void {
    for (const { object, axis, speed } of this.rotations) {
      let parent: THREE.Object3D | null = object;
      let active = true;
      while (parent) { if (parent.userData.industryActive === false) { active = false; break; } parent = parent.parent; }
      if (active) object.rotation[axis] += Math.min(delta, 0.08) * speed;
    }
  }

  releaseAnimations(group: THREE.Object3D): void {
    const objects = new Set<THREE.Object3D>();
    group.traverse(object => objects.add(object));
    for (let index = this.rotations.length - 1; index >= 0; index--) {
      if (objects.has(this.rotations[index].object)) this.rotations.splice(index, 1);
    }
  }

  clearAnimations(): void {
    this.rotations.length = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.clearAnimations();
    for (const geometry of this.merged) geometry.dispose();
    this.merged.clear(); this.templates.clear();
    for (const geometry of this.geometry.values()) geometry.dispose();
    this.surfaces.dispose();
    this.geometry.clear(); this.material.clear();
  }
}
