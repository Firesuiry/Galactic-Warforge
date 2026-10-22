import * as THREE from 'three';

/**
 * 建筑/单位表面材质（第 23 轮 3A）：用 ambientCG 的 CC0 PBR 贴图替换纯色材质。
 *
 * 设计要点：
 * - **材质族共享**：同一族（陶瓷 / 拉丝钛 / 石墨板 / 花纹板 / 橡胶 / 塑料）全场只建一份材质，
 *   所有建筑实例共享，`StaticBatches` 才能按材质归并（合批数不随建筑数上升）。
 * - **三平面映射**：贴图按对象空间坐标采样（见 `industrial-materials.ts`），不依赖各几何体
 *   自带的 0..1 UV，所以大面和小零件的纹素密度一致（1 格 ≈ 1 次重复），不会拉伸。
 * - **回退**：贴图未加载完 / 加载失败时用 `industrial-finishes.ts` 的确定性程序纹理，
 *   同步 API 不变；加载完成后场景重建实体换成 PBR 材质。
 * - **阵营**：底色走 `palette.ts`，同一材质族按阵营各一份（己方白陶瓷、敌方枪灰、黑雾黑曜石）。
 */

import { createIndustrialFinishes, type IndustrialFinishes } from './industrial-finishes';
import { createPbrMaterial, industrialMaterialsReady, type PbrFamily } from './industrial-materials';
import { ACCENT_METAL, BUILDING_MATERIALS, GLOW, SURFACE, STATUS_LIGHT } from './palette';

/** 材质池的键：材质族 + 阵营（或发光色）。 */
export type SurfaceKey =
  | 'ceramic' | 'graphite' | 'alloy' | 'plate' | 'plastic' | 'rubber'
  | 'enemyCeramic' | 'fogCeramic'
  | 'copper' | 'copperDark' | 'glass'
  | 'blue' | 'orange' | 'fogGlow' | 'fogHostileGlow' | 'warning' | 'hazard';

interface SurfaceSpec {
  family?: PbrFamily;
  color: string;
  roughness: number;
  metalness: number;
  emissive?: string;
  emissiveIntensity?: number;
  /** 旧程序纹理族（贴图未就绪时的细节来源）。 */
  procedural?: 'ceramic' | 'alloy' | 'graphite';
  /** 三平面重复密度（每格几次重复；1 = 默认）：小件用更细的纹理。 */
  repeat?: number;
}

const OWN = BUILDING_MATERIALS.own, ENEMY = BUILDING_MATERIALS.enemy, FOG = BUILDING_MATERIALS.fog;
const SPEC: Record<SurfaceKey, SurfaceSpec> = {
  ceramic: { family: 'ceramic', color: OWN.ceramic.color, ...SURFACE.ceramic, procedural: 'ceramic' },
  graphite: { family: 'graphite', color: OWN.graphite.color, ...SURFACE.graphite, procedural: 'graphite' },
  alloy: { family: 'alloy', color: OWN.alloy.color, ...SURFACE.alloy, procedural: 'alloy' },
  plate: { family: 'plate', color: OWN.plate.color, ...SURFACE.plate },
  plastic: { family: 'plastic', color: OWN.plastic.color, ...SURFACE.plastic },
  rubber: { family: 'rubber', color: '#18242a', ...SURFACE.rubber },
  enemyCeramic: { family: 'ceramic', color: ENEMY.ceramic.color, ...SURFACE.ceramic, procedural: 'ceramic' },
  fogCeramic: { family: 'ceramic', color: FOG.ceramic.color, roughness: .5, metalness: .3, procedural: 'ceramic' },
  // 铜/黄铜小件在 1 格里是细管细环：每格 1.2 次重复才读得出金属拉丝，否则整根管是均匀色。
  copper: { family: 'alloy', color: ACCENT_METAL.copper, roughness: .34, metalness: .78, repeat: 1.2 },
  copperDark: { family: 'alloy', color: ACCENT_METAL.copperDark, roughness: .55, metalness: .62, repeat: 1.2 },
  glass: { color: '#153c4f', roughness: .17, metalness: .72, emissive: '#073341', emissiveIntensity: .5 },
  blue: { color: '#8befff', roughness: .25, metalness: .3, emissive: GLOW.own, emissiveIntensity: 6 },
  orange: { color: '#ffc97c', roughness: .38, metalness: .3, emissive: GLOW.enemy, emissiveIntensity: 6 },
  fogGlow: { color: '#b9a6ff', roughness: .3, metalness: .2, emissive: '#7d5cff', emissiveIntensity: 3.2 },
  fogHostileGlow: { color: '#ff8a8a', roughness: .3, metalness: .2, emissive: GLOW.fog, emissiveIntensity: 5 },
  warning: { color: STATUS_LIGHT.idle, roughness: .5, metalness: .25, emissive: GLOW.warning, emissiveIntensity: 2.4 },
  hazard: { color: '#ffffff', roughness: .55, metalness: .2, emissive: GLOW.warning, emissiveIntensity: .35 },
};

/**
 * 警示条纹贴图（斜向琥珀/石墨条带，64² DataTexture）：几何上的薄片贴花，
 * 所有建筑的警示条共用同一材质（合批后 1 个绘制调用）。不用 canvas，测试环境也能生成。
 */
function hazardTexture(): THREE.DataTexture {
  const size = 64, data = new Uint8Array(size * size * 4);
  const amber = [255, 176, 74], dark = [26, 30, 34];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const band = ((x + y) % 32) < 16;
    const color = band ? amber : dark;
    // 轻微磨损：固定种子的细噪声，避免条纹像纯色贴纸。
    const wear = ((Math.imul(x * 73856093 ^ y * 19349663, 0x45d9f3b) >>> 16) & 15) / 15 * 0.12;
    const offset = (y * size + x) * 4;
    data[offset] = Math.round(color[0] * (1 - wear));
    data[offset + 1] = Math.round(color[1] * (1 - wear));
    data[offset + 2] = Math.round(color[2] * (1 - wear));
    data[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = 'industrial-hazard';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 一个 `IndustrialModels` 实例的表面材质池。贴图就绪前后都可以构造：
 * `upgrade()` 在贴图加载完成后把带贴图的材质换进池里（旧的程序材质保留给已发出的实例，
 * 场景随后会重建实体，旧实例随 `dispose()` 释放）。
 */
export class IndustrialSurfaces {
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly finishes: IndustrialFinishes;
  private readonly procedural = new Set<THREE.MeshStandardMaterial>();
  private readonly owned: THREE.Texture[] = [];
  private pbr = false;
  private disposed = false;
  private hazard?: THREE.Texture;

  constructor(private readonly anisotropy = 4) {
    this.finishes = createIndustrialFinishes({ anisotropy });
    // 贴图可能已经加载完（后续场景/画廊）：直接建 PBR 材质，否则先用程序纹理回退。
    this.pbr = industrialMaterialsReady();
    this.rebuild();
  }

  /** 当前是否用 PBR 贴图（false = 程序纹理回退）。 */
  get usingPbr() { return this.pbr; }

  /**
   * 取材质。`variant` = 逐建筑调亮度用的副本（M5：停机建筑的发光件要单独调暗，不能改共享材质）；
   * 变体按 `key:variant` 缓存，每栋建筑仍只建一份（合批不受影响）。
   */
  get(key: SurfaceKey, variant?: string): THREE.MeshStandardMaterial {
    const cacheKey = variant ? `${key}:${variant}` : key;
    let material = this.materials.get(cacheKey);
    if (!material) { material = this.build(key); this.materials.set(cacheKey, material); }
    return material;
  }

  /** 贴图加载完成后调用：换用带 PBR 贴图的材质。返回是否切换成功。 */
  upgrade(): boolean {
    if (this.pbr || this.disposed || !industrialMaterialsReady()) return false;
    this.releaseMaterials();
    this.pbr = true;
    this.rebuild();
    return true;
  }

  /** 清空材质池，按需懒建（`get()`）：没有模型用到的材质族不建（审查 L4：23 个材质只建实际用到的）。 */
  private rebuild() {
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }

  private build(key: SurfaceKey): THREE.MeshStandardMaterial {
    const spec = SPEC[key];
    if (key === 'hazard') {
      // 贴图只建一次：每次 rebuild 新建一张 64² 贴图会让旧的永不回收（审查 L4）。
      if (!this.hazard) { this.hazard = hazardTexture(); this.owned.push(this.hazard); }
      const material = new THREE.MeshStandardMaterial({ map: this.hazard, roughness: spec.roughness, metalness: spec.metalness,
        emissive: GLOW.warning, emissiveIntensity: spec.emissiveIntensity, emissiveMap: this.hazard });
      material.name = 'industrial-hazard';
      this.applyEmissiveTint(material);
      this.procedural.add(material);
      return material;
    }
    const base: THREE.MeshStandardMaterialParameters = {
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
      emissive: spec.emissive ?? '#000000',
      emissiveIntensity: spec.emissiveIntensity ?? 0,
    };
    if (this.pbr && spec.family) {
      const material = createPbrMaterial(spec.family, spec.color, base, spec.repeat);
      if (material) {
        material.name = `industrial-${key}`;
        this.applyEmissiveTint(material);
        return material;
      }
    }
    // 回退：程序纹理（只给陶瓷/合金/石墨三个主族，其余是纯色 + 参数）。
    const finish = spec.procedural ? this.finishes[spec.procedural] : undefined;
    const material = new THREE.MeshStandardMaterial({ ...base, ...(finish ?? {}) });
    material.name = `industrial-${key}`;
    this.applyEmissiveTint(material);
    this.procedural.add(material);
    return material;
  }

  /**
   * 发光件（M5）：材质颜色乘实例色（`instanceColor`）时，自发光默认不跟着变，
   * 停机建筑没法逐栋调暗。这里给发光材质注入一行：`totalEmissiveRadiance *= vColor.rgb`，
   * 于是合批时把该建筑灯珠的实例色写成 0.3 灰，就得到「停机降到 30%」。
   * 只对自发光材质（emissiveIntensity > 0）注入，普通件不受影响。
   */
  private applyEmissiveTint(material: THREE.MeshStandardMaterial) {
    if (!(material.emissiveIntensity > 0)) return;
    // 保留已有注入（三平面材质），在其后追加自发光乘法。
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey?.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        // 只在有顶点/实例色时乘：运行中的建筑没有 instanceColor，着色器里就没有 vColor。
        '#include <emissivemap_fragment>\n#if defined( USE_COLOR )\n\ttotalEmissiveRadiance *= vColor.rgb;\n#endif',
      );
    };
    material.customProgramCacheKey = () => `${previousKey?.() ?? ''}:emissive-tint`;
  }

  private releaseMaterials() {
    for (const material of this.procedural) material.dispose();
    this.procedural.clear();
    // PBR 材质没有进 procedural 集合，单独释放，避免换材质时泄漏。
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.procedural.clear();
    for (const texture of this.owned) texture.dispose();
    this.owned.length = 0;
    this.finishes.dispose();
  }
}
