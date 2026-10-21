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
  | 'enemyCeramic' | 'enemyGraphite' | 'enemyAlloy' | 'enemyPlate'
  | 'fogCeramic' | 'fogGraphite' | 'fogAlloy'
  | 'copper' | 'copperDark' | 'glass'
  | 'blue' | 'orange' | 'fogGlow' | 'fogHostileGlow' | 'warning';

interface SurfaceSpec {
  family?: PbrFamily;
  color: string;
  roughness: number;
  metalness: number;
  emissive?: string;
  emissiveIntensity?: number;
  /** 旧程序纹理族（贴图未就绪时的细节来源）。 */
  procedural?: 'ceramic' | 'alloy' | 'graphite';
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
  enemyGraphite: { family: 'graphite', color: ENEMY.graphite.color, ...SURFACE.graphite, procedural: 'graphite' },
  enemyAlloy: { family: 'alloy', color: ENEMY.alloy.color, ...SURFACE.alloy, procedural: 'alloy' },
  enemyPlate: { family: 'plate', color: ENEMY.plate.color, ...SURFACE.plate },
  fogCeramic: { family: 'ceramic', color: FOG.ceramic.color, roughness: .5, metalness: .3, procedural: 'ceramic' },
  fogGraphite: { family: 'graphite', color: FOG.graphite.color, roughness: .55, metalness: .35, procedural: 'graphite' },
  fogAlloy: { family: 'alloy', color: FOG.alloy.color, roughness: .42, metalness: .7, procedural: 'alloy' },
  copper: { family: 'alloy', color: ACCENT_METAL.copper, roughness: .34, metalness: .78 },
  copperDark: { family: 'alloy', color: ACCENT_METAL.copperDark, roughness: .55, metalness: .62 },
  glass: { color: '#153c4f', roughness: .17, metalness: .72, emissive: '#073341', emissiveIntensity: .5 },
  blue: { color: '#8befff', roughness: .25, metalness: .3, emissive: GLOW.own, emissiveIntensity: 6 },
  orange: { color: '#ffc97c', roughness: .38, metalness: .3, emissive: GLOW.enemy, emissiveIntensity: 6 },
  fogGlow: { color: '#b9a6ff', roughness: .3, metalness: .2, emissive: '#7d5cff', emissiveIntensity: 3.2 },
  fogHostileGlow: { color: '#ff8a8a', roughness: .3, metalness: .2, emissive: GLOW.fog, emissiveIntensity: 5 },
  warning: { color: STATUS_LIGHT.idle, roughness: .5, metalness: .25, emissive: GLOW.warning, emissiveIntensity: 2.4 },
};

/**
 * 一个 `IndustrialModels` 实例的表面材质池。贴图就绪前后都可以构造：
 * `upgrade()` 在贴图加载完成后把带贴图的材质换进池里（旧的程序材质保留给已发出的实例，
 * 场景随后会重建实体，旧实例随 `dispose()` 释放）。
 */
export class IndustrialSurfaces {
  private readonly materials = new Map<SurfaceKey, THREE.MeshStandardMaterial>();
  private readonly finishes: IndustrialFinishes;
  private readonly procedural = new Set<THREE.MeshStandardMaterial>();
  private pbr = false;
  private disposed = false;

  constructor(private readonly anisotropy = 4) {
    this.finishes = createIndustrialFinishes({ anisotropy });
    this.rebuild();
  }

  /** 当前是否用 PBR 贴图（false = 程序纹理回退）。 */
  get usingPbr() { return this.pbr; }

  get(key: SurfaceKey): THREE.MeshStandardMaterial {
    let material = this.materials.get(key);
    if (!material) { material = this.build(key); this.materials.set(key, material); }
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

  private rebuild() {
    for (const key of Object.keys(SPEC) as SurfaceKey[]) this.materials.set(key, this.build(key));
  }

  private build(key: SurfaceKey): THREE.MeshStandardMaterial {
    const spec = SPEC[key];
    const base: THREE.MeshStandardMaterialParameters = {
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
      emissive: spec.emissive ?? '#000000',
      emissiveIntensity: spec.emissiveIntensity ?? 0,
    };
    if (this.pbr && spec.family) {
      const material = createPbrMaterial(spec.family, spec.color, base);
      if (material) {
        material.name = `industrial-${key}`;
        return material;
      }
    }
    // 回退：程序纹理（只给陶瓷/合金/石墨三个主族，其余是纯色 + 参数）。
    const finish = spec.procedural ? this.finishes[spec.procedural] : undefined;
    const material = new THREE.MeshStandardMaterial({ ...base, ...(finish ?? {}) });
    material.name = `industrial-${key}`;
    this.procedural.add(material);
    return material;
  }

  private releaseMaterials() {
    for (const material of this.procedural) material.dispose();
    this.procedural.clear();
    this.materials.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.procedural.clear();
    this.finishes.dispose();
  }
}
