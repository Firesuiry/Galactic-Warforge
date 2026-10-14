/**
 * 物品配色：细分网格后传送带/机器人车顶上的货物方块要能一眼分辨物品，
 * 而服务端目录只按「物品大类」给色（catalog.go itemCatalogColor：所有矿石同色、
 * 所有材料同色），铁矿/铜矿/煤/石材在带上会完全同色，读不出流动的是什么。
 *
 * 这里给出细分网格后的**客户端物品配色表**（覆盖 DSP 式开局产线的常见物品），
 * 目录色作为兜底。所有渲染侧（2D 货物圆点、3D 货物方块、机器人车顶货箱、
 * 详情面板色块）都从这里取色，保证同一物品在各视图里颜色一致。
 *
 * 取色规则（试玩 1015 §6-3：旧表两组色都是低饱和冷灰蓝，3D 近景里铁块/铁矿
 * 分不出来；1015 §6-4 又要求「彩色物料、可分辨」）：
 * - **原矿**：暗、低明度、带杂色（铁灰蓝 / 铜赭红 / 石土黄 / 煤近黑 / 硅暗青），
 *   彼此靠**色相**分开而不是靠明度；
 * - **锭/砖**：同一族里最亮、最饱和的一档（铁锭近白蓝、铜锭橙、硅锭青、石砖暖黄），
 *   一眼看出「这是冶炼过的」；
 * - **中间件/矩阵/弹药**：高饱和、互相拉开的信号色（齿轮金黄、磁线圈红、
 *   电路板绿、处理器紫、电磁矩阵琥珀……）。
 *
 * 颜色值一律按 sRGB 书写（hex），3D 侧由 `itemColor()` 显式按 SRGBColorSpace
 * 解释一次；`item-colors.test.ts` 用 CIE Lab 距离断言常用物品两两可分，
 * 不靠肉眼看图（换色时先跑测试）。
 */

/** 资源点调色板（visible-entities 的 resourceColors）与物品色的共同兜底。 */
export const ITEM_COLOR_FALLBACK = '#d8ae67';

const ITEM_COLORS: Record<string, string> = {
  // 矿石：暗 + 杂色，彼此靠色相区分（明度都压在 L* 40 上下）
  iron_ore: '#5b6779',
  copper_ore: '#8a4a22',
  stone_ore: '#7a7350',
  silicon_ore: '#1f6f6b',
  titanium_ore: '#7a6fa8',
  coal: '#1f2226',
  fire_ice: '#1f5fa8',
  kimberlite_ore: '#4a3f7a',
  spiniform_stalagmite_crystal: '#8a4fa8',
  fractal_silicon: '#3f9c6a',
  grating_crystal: '#a8813f',
  crude_oil: '#5a2f6b',
  // 冶炼产物：同族里最亮最饱和的一档（「亮 = 加工过」）
  iron_ingot: '#dfe8f5',
  copper_ingot: '#f08a2a',
  stone_brick: '#ffd48a',
  silicon_ingot: '#2fd8cc',
  titanium_ingot: '#cfc9e8',
  steel: '#8ea6bd',
  glass: '#a8e8f5',
  diamond: '#e8fbff',
  graphene: '#3f4a58',
  // 中间件：高饱和信号色，两两拉开
  gear: '#ffd400',
  magnetic_coil: '#ff3b30',
  circuit_board: '#22dd77',
  motor: '#b9a2e8',
  magnet: '#ff4fa8',
  plastic: '#fff2cf',
  prism: '#5ce0ff',
  processor: '#7a5cff',
  microcrystalline_component: '#c060ff',
  particle_container: '#2f6fd0',
  // 燃料
  hydrogen: '#cbe8ff',
  deuterium: '#5f8fe8',
  plant_fuel: '#8fce6b',
  hydrogen_fuel_rod: '#a9f0d8',
  deuterium_fuel_rod: '#7f6fe8',
  // 矩阵 / 科技
  electromagnetic_matrix: '#ffc400',
  energy_matrix: '#ff9a3c',
  structure_matrix: '#4f9fe8',
  information_matrix: '#8affc1',
  gravity_matrix: '#c6a0ff',
  universe_matrix: '#ff9de0',
  // 弹药
  ammo_bullet: '#ffcf70',
  ammo_missile: '#ff7a4c',
  plasma_capsule: '#ff7be0',
};

/**
 * 物品 id → 颜色。
 *
 * **本表优先、目录色兜底**：目录色只按大类给（ore 全是 #adb5bd、material 全是 #74c0fc），
 * 直接采用会让铁矿/铜矿/石材/煤在带上同色、铁块/铜块同色——正是本表要解决的问题，
 * 所以覆盖到的物品一律用本表色；表里没有的（新物品/模组物品）才回落到目录色。
 */
export function getItemColorValue(itemId: string | undefined, catalogColor?: string): string {
  if (itemId && ITEM_COLORS[itemId]) return ITEM_COLORS[itemId];
  if (catalogColor) return catalogColor;
  return ITEM_COLOR_FALLBACK;
}

/** 数值形式（Pixi fill/着色用）。 */
export function getItemColorNumber(itemId: string | undefined, catalogColor?: string): number {
  return Number.parseInt(getItemColorValue(itemId, catalogColor).slice(1), 16);
}

/** 本表覆盖的物品 id（测试用）。 */
export function listedItemColorIds(): string[] {
  return Object.keys(ITEM_COLORS);
}
