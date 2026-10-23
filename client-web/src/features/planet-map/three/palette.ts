/**
 * 3A 画质调色板（第 23 轮）：阵营色、发光色、粗糙/金属参数集中在这里。
 *
 * 规则来源：`docs/guide/3A画质.md` §1「美术方向」。所有工业资产（程序化模型、
 * GLB 阵营涂装、状态灯、传送带/分拣器）取色都从这里读，不再各自写十六进制。
 *
 * 颜色是 sRGB 十六进制；材质参数（roughness/metalness）是线性标量，供
 * `MeshStandardMaterial` 直接使用。
 */

/** 三套材质族的表面参数（粗糙 / 金属度）。纹理细节由 `industrial-materials.ts` 叠加。 */
export interface SurfaceStyle {
  roughness: number;
  metalness: number;
}

/**
 * 材质族（与 `industrial-materials.ts` 的 PBR 贴图一一对应）：
 * - `ceramic`  白色涂装金属面板（己方主装甲 / 壳体）
 * - `alloy`    拉丝钛（结构件、支架、炮管）
 * - `graphite` 石墨色金属板（底座、机架、暗部）
 * - `plate`    花纹钢板（地基、踏板、平台）
 * - `rubber`   橡胶（传送带带面、轮子）
 * - `plastic`  哑光塑料（线缆槽、按钮座、非金属小件）
 */
export type MaterialFamily = 'ceramic' | 'alloy' | 'graphite' | 'plate' | 'rubber' | 'plastic';

export const SURFACE: Record<MaterialFamily, SurfaceStyle> = {
  ceramic: { roughness: 0.45, metalness: 0.12 },
  alloy: { roughness: 0.35, metalness: 0.9 },
  graphite: { roughness: 0.6, metalness: 0.3 },
  plate: { roughness: 0.52, metalness: 0.72 },
  rubber: { roughness: 0.88, metalness: 0.04 },
  plastic: { roughness: 0.62, metalness: 0.05 },
};

/** 阵营底色（sRGB）。 */
export const FACTION = {
  own: {
    ceramic: '#e9edf0',
    graphite: '#2a3036',
    alloy: '#9aa3ab',
  },
  enemy: {
    ceramic: '#3b3f45',
    graphite: '#24282c',
    alloy: '#6d757d',
  },
  fog: {
    ceramic: '#120c16',
    graphite: '#0b070e',
    alloy: '#3a3040',
  },
} as const;

/** 发光色（sRGB）：己方青、敌方锈橙、黑雾品红；琥珀只作警示点缀。 */
export const GLOW = {
  own: '#3fe6ff',
  enemy: '#e0662a',
  fog: '#ff2a6a',
  warning: '#ffb04a',
} as const;

/** 状态灯三态（`status-lights.ts`）：运行青、空闲/缺料琥珀、缺电红。 */
export const STATUS_LIGHT = {
  running: GLOW.own,
  idle: GLOW.warning,
  noPower: '#ff3b3b',
} as const;

/** 地表/环境常量（光照分支也会引用，这里只记录与工业资产共用的部分）。 */
export const ENVIRONMENT = {
  sun: '#ffe2bd',
  sky: '#9cc7ff',
} as const;

/** 铜/黄铜小件（管线接头、铜环）：保留金属高光，但比旧值暗一档，避免近景读成 LED。 */
export const ACCENT_METAL = {
  copper: '#bb7842',
  copperDark: '#7d4a24',
} as const;

export type FactionKey = keyof typeof FACTION;

/** 把 sRGB 十六进制转成 THREE 可用的线性 Color 数值（three 的 Color 构造器默认按 sRGB 解析）。 */
export function colorOf(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

/**
 * 程序化材质库的完整材质表（键名是 `industrial-models.ts` 的 Finish 名）。
 * 未列出的键由 `industrial-materials.ts` 按需构造（玻璃、发光、黑雾等）。
 */
export interface PaletteEntry {
  color: string;
  family?: MaterialFamily;
  emissive?: string;
  emissiveIntensity?: number;
}

export const BUILDING_MATERIALS: Record<'own' | 'enemy' | 'fog', Record<'ceramic' | 'graphite' | 'alloy' | 'plate' | 'plastic', PaletteEntry>> = {
  own: {
    ceramic: { color: FACTION.own.ceramic, family: 'ceramic' },
    graphite: { color: FACTION.own.graphite, family: 'graphite' },
    alloy: { color: FACTION.own.alloy, family: 'alloy' },
    plate: { color: '#7d858c', family: 'plate' },
    plastic: { color: '#1d2429', family: 'plastic' },
  },
  enemy: {
    ceramic: { color: FACTION.enemy.ceramic, family: 'ceramic' },
    graphite: { color: FACTION.enemy.graphite, family: 'graphite' },
    alloy: { color: FACTION.enemy.alloy, family: 'alloy' },
    plate: { color: '#4a5057', family: 'plate' },
    plastic: { color: '#16191c', family: 'plastic' },
  },
  fog: {
    ceramic: { color: FACTION.fog.ceramic, family: 'ceramic' },
    graphite: { color: FACTION.fog.graphite, family: 'graphite' },
    alloy: { color: FACTION.fog.alloy, family: 'alloy' },
    plate: { color: '#2a2230', family: 'plate' },
    plastic: { color: '#0d0910', family: 'plastic' },
  },
};

/** 单位涂装：己方白蓝、敌方玩家橙、黑雾中立暗紫灰、黑雾敌对暗红。 */
export const UNIT_PAINT = {
  own: { armor: FACTION.own.ceramic, light: GLOW.own },
  enemy: { armor: FACTION.enemy.ceramic, light: GLOW.enemy },
  fog_neutral: { armor: FACTION.fog.ceramic, light: GLOW.fog },
  fog_hostile: { armor: '#6e2228', light: '#ff4444' },
} as const;
