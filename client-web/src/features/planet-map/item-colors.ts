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
 * - **原矿**：暗、低明度、带杂色（铁蓝 / 铜赭红 / 石土黄 / 煤近黑 / 硅暗青），
 *   彼此靠**色相**分开而不是靠明度；
 * - **锭/砖**：同一族里最亮、最饱和的一档（铁锭近白蓝、铜锭橙、硅锭青、石砖暖黄），
 *   一眼看出「这是冶炼过的」；
 * - **中间件/矩阵/弹药**：高饱和、互相拉开的信号色（齿轮金黄、磁线圈品红、
 *   电路板绿、钢材深蓝灰……）。
 *
 * 颜色值一律按 sRGB 书写（hex），3D 侧由 `itemColor()` 显式按 SRGBColorSpace
 * 解释一次；`item-colors.test.ts` 用 CIE Lab 距离断言常用物品两两可分，
 * 不靠肉眼看图（换色时先跑测试）。
 */

/** 资源点调色板（visible-entities 的 resourceColors）与物品色的共同兜底。 */
export const ITEM_COLOR_FALLBACK = '#d8ae67';

const ITEM_COLORS: Record<string, string> = {
  // 矿石：暗 + 杂色，彼此靠色相区分（明度都压在 L* 55 以下）
  iron_ore: '#2f5a92',
  copper_ore: '#7a3410',
  stone_ore: '#8a8055',
  silicon_ore: '#1f6b5e',
  titanium_ore: '#5f4278',
  coal: '#1c1a23',
  fire_ice: '#068be3',
  kimberlite_ore: '#4fa697',
  spiniform_stalagmite_crystal: '#f31ef6',
  fractal_silicon: '#298e3a',
  grating_crystal: '#ddab88',
  crude_oil: '#31093e',
  // 冶炼产物：同族里最亮最饱和的一档（「亮 = 加工过」）
  iron_ingot: '#e6e8f4',
  copper_ingot: '#ff7a1f',
  stone_brick: '#e9dcb4',
  silicon_ingot: '#a6f2ea',
  titanium_ingot: '#c3b0e0',
  steel: '#5b7a84',
  glass: '#9acba2',
  diamond: '#91d1ff',
  graphene: '#364646',
  // 中间件：高饱和信号色，两两拉开
  gear: '#ffd400',
  magnetic_coil: '#ff2f8f',
  circuit_board: '#22c552',
  motor: '#a86424',
  magnet: '#b70b0b',
  plastic: '#9a97a2',
  prism: '#86a0f3',
  processor: '#18ecb7',
  microcrystalline_component: '#8826dc',
  particle_container: '#0100b8',
  // 燃料
  hydrogen: '#22daf1',
  deuterium: '#0b305b',
  plant_fuel: '#c3f236',
  hydrogen_fuel_rod: '#acc9cd',
  deuterium_fuel_rod: '#5e5fe8',
  // 矩阵 / 科技
  electromagnetic_matrix: '#a89b05',
  energy_matrix: '#f53d3d',
  structure_matrix: '#2da9d2',
  information_matrix: '#10f910',
  gravity_matrix: '#ab75d1',
  universe_matrix: '#f192c2',
  // 弹药
  ammo_bullet: '#574819',
  ammo_missile: '#4c1010',
  plasma_capsule: '#bd0f83',
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
