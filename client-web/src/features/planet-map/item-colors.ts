/**
 * 物品配色：细分网格后传送带/机器人车顶上的货物方块要能一眼分辨物品，
 * 而服务端目录只按「物品大类」给色（catalog.go itemCatalogColor：所有矿石同色、
 * 所有材料同色），铁矿/铜矿/煤/石材在带上会完全同色，读不出流动的是什么。
 *
 * 这里给出细分网格后的**客户端物品配色表**（覆盖 DSP 式开局产线的常见物品），
 * 目录色作为兜底。所有渲染侧（2D 货物圆点、3D 货物方块、机器人车顶货箱、
 * 详情面板色块）都从这里取色，保证同一物品在各视图里颜色一致。
 */

/** 资源点调色板（visible-entities 的 resourceColors）与物品色的共同兜底。 */
export const ITEM_COLOR_FALLBACK = '#d8ae67';

const ITEM_COLORS: Record<string, string> = {
  // 矿石（原矿：矿物色，与行星资源点同系但更饱和，带上可辨）
  iron_ore: '#9fb2c4',
  copper_ore: '#e2843c',
  stone_ore: '#cbc3a6',
  silicon_ore: '#6fd0cb',
  titanium_ore: '#b9c6d4',
  coal: '#4c525a',
  fire_ice: '#8fd8ff',
  kimberlite_ore: '#cfe6f2',
  spiniform_stalagmite_crystal: '#c0a6ff',
  fractal_silicon: '#7fe0d8',
  grating_crystal: '#ffd9a0',
  crude_oil: '#4d3a89',
  // 冶炼产物（金属锭）
  iron_ingot: '#c9d3dd',
  copper_ingot: '#f08a45',
  stone_brick: '#ded6bd',
  silicon_ingot: '#a9dfe2',
  titanium_ingot: '#dfe6ee',
  steel: '#8f9aa8',
  glass: '#bfe9f5',
  diamond: '#dff6ff',
  graphene: '#5d6b78',
  // 中间件
  gear: '#e0b25c',
  magnetic_coil: '#ff9f5a',
  circuit_board: '#7fe08a',
  motor: '#c3cbd6',
  magnet: '#ff7ba8',
  plastic: '#f2f2f2',
  prism: '#b8f0ff',
  processor: '#6ee7d7',
  microcrystalline_component: '#d9c4ff',
  particle_container: '#8ad4ff',
  // 燃料
  hydrogen: '#a8d8ff',
  deuterium: '#7fb2ff',
  plant_fuel: '#8fce6b',
  hydrogen_fuel_rod: '#bfe8ff',
  deuterium_fuel_rod: '#7fa6ff',
  // 矩阵 / 科技
  electromagnetic_matrix: '#ffd43b',
  energy_matrix: '#ffb84d',
  structure_matrix: '#8fd3ff',
  information_matrix: '#8affc1',
  gravity_matrix: '#c6a0ff',
  universe_matrix: '#ff9de0',
  // 弹药
  ammo_bullet: '#ffcf70',
  ammo_missile: '#ff8a5c',
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
