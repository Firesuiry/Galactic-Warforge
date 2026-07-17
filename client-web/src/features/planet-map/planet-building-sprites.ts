/**
 * 建筑程序化矢量精灵烘焙（planet-building-sprites）。
 *
 * 告别"footprint 描边盒 + 居中 emoji"：按 ~6 种剪影原型（tower/dome/furnace/depot/belt/special）
 * 在离屏 canvas 上按 32px/tile 超采样绘制矢量结构（投影 → 底座板 → 主体结构 → 顶部细节），
 * 转 Pixi Texture 全局缓存（键 `bldg:<archetype>:<w>x<h>:<state>`，纹理不随场景销毁），
 * 场景侧 Sprite 缩放到 footprint×tileSize 显示。
 *
 * - 视觉溢出 footprint：水平各 ~8%+2px，上方为结构高度（伪 3D，约 0.55 倍 footprint 高），
 *   下方为投影余量；场景按 (padX, topExtra) 偏移摆放使 footprint 原点对齐容器原点。
 * - 队伍归属不烘焙（缓存键不含队伍）：己/敌描边由场景侧底座描边条承担。
 * - 受损/故障 = distressed 烘焙变体（暗化 + 警示斜纹）+ 场景侧警示角标呼吸（frozen 门）。
 * - wind_turbine 叶片单独烘焙（`bldg-blades:<w>x<h>`），由场景 ticker 驱动旋转。
 * - 全部绘制确定性：同参数必得同纹理（截图可复现）。
 */

import { Texture } from 'pixi.js';

import type { Building } from '@shared/types';

// ---------- 原型（archetype）与类型映射 ----------

export type BuildingArchetype = 'tower' | 'dome' | 'furnace' | 'depot' | 'belt' | 'special';

/** 受损/故障烘焙变体：normal = 常规；distressed = 暗化 + 警示斜纹。 */
export type BuildingVisualState = 'normal' | 'distressed';

/**
 * 建筑类型 → 剪影原型。未列出的类型按关键词兜底（含 tower/lab/smelter 等），
 * 完全不认识走 special。新增建筑类型无需改这里也能得到合理剪影。
 */
const ARCHETYPE_BY_TYPE: Record<string, BuildingArchetype> = {
  // tower：底座 + 塔筒（电力塔/防御塔/采集立架/天线索塔/发射设施）
  wind_turbine: 'tower',
  tesla_tower: 'tower',
  wireless_power_tower: 'tower',
  satellite_substation: 'tower',
  signal_tower: 'tower',
  jammer_tower: 'tower',
  laser_turret: 'tower',
  gauss_turret: 'tower',
  missile_turret: 'tower',
  plasma_turret: 'tower',
  sr_plasma_turret: 'tower',
  implosion_cannon: 'tower',
  planetary_shield_generator: 'tower',
  em_rail_ejector: 'tower',
  vertical_launching_silo: 'tower',
  mining_machine: 'tower',
  advanced_mining_machine: 'tower',
  oil_extractor: 'tower',
  water_pump: 'tower',
  orbital_collector: 'tower',
  // dome：穹顶 + 辉光（科研/分析/接收）
  matrix_lab: 'dome',
  self_evolution_lab: 'dome',
  battlefield_analysis_base: 'dome',
  ray_receiver: 'dome',
  artificial_star: 'dome',
  // furnace：方炉体 + 烟囱 + 发光窗（冶炼/组装/化工/火电）
  arc_smelter: 'furnace',
  negentropy_smelter: 'furnace',
  plane_smelter: 'furnace',
  assembling_machine_mk1: 'furnace',
  assembling_machine_mk2: 'furnace',
  assembling_machine_mk3: 'furnace',
  recomposing_assembler: 'furnace',
  assembler: 'furnace',
  chemical_plant: 'furnace',
  quantum_chemical_plant: 'furnace',
  oil_refinery: 'furnace',
  fractionator: 'furnace',
  thermal_power_plant: 'furnace',
  mini_fusion_power_plant: 'furnace',
  miniature_particle_collider: 'furnace',
  spray_coater: 'furnace',
  automatic_piler: 'furnace',
  pile_sorter: 'furnace',
  geothermal_power_station: 'furnace',
  // depot：箱体 + 顶棚（仓储/物流/蓄电）
  depot_mk1: 'depot',
  depot_mk2: 'depot',
  storage_tank: 'depot',
  planetary_logistics_station: 'depot',
  interstellar_logistics_station: 'depot',
  logistics_distributor: 'depot',
  accumulator: 'depot',
  accumulator_full: 'depot',
  energy_exchanger: 'depot',
  // belt：低平带体 + 方向箭头纹
  conveyor_belt_mk1: 'belt',
  conveyor_belt_mk2: 'belt',
  conveyor_belt_mk3: 'belt',
  splitter: 'belt',
  sorter_mk1: 'belt',
  sorter_mk2: 'belt',
  sorter_mk3: 'belt',
  traffic_monitor: 'belt',
  // special：solar_panel 等未列名类型走兜底
};

const ARCHETYPE_KEYWORDS: Array<[string, BuildingArchetype]> = [
  ['belt', 'belt'],
  ['conveyor', 'belt'],
  ['lab', 'dome'],
  ['analysis', 'dome'],
  ['receiver', 'dome'],
  ['smelter', 'furnace'],
  ['assembl', 'furnace'],
  ['chemical', 'furnace'],
  ['refinery', 'furnace'],
  ['collider', 'furnace'],
  ['power_plant', 'furnace'],
  ['depot', 'depot'],
  ['storage', 'depot'],
  ['logistics', 'depot'],
  ['accumulator', 'depot'],
  ['tower', 'tower'],
  ['turret', 'tower'],
  ['cannon', 'tower'],
  ['turbine', 'tower'],
  ['mining', 'tower'],
  ['extractor', 'tower'],
  ['pump', 'tower'],
  ['silo', 'tower'],
  ['ejector', 'tower'],
];

export function resolveBuildingArchetype(buildingType: string): BuildingArchetype {
  const direct = ARCHETYPE_BY_TYPE[buildingType];
  if (direct) {
    return direct;
  }
  for (const [keyword, archetype] of ARCHETYPE_KEYWORDS) {
    if (buildingType.includes(keyword)) {
      return archetype;
    }
  }
  return 'special';
}

/** hp 未满或 runtime 故障（error/no_power）→ distressed 烘焙变体。paused 是合法停工，不算故障。 */
export function resolveBuildingVisualState(
  building: Pick<Building, 'hp' | 'max_hp'> & { runtime?: { state?: string } },
): BuildingVisualState {
  const damaged = building.max_hp > 0 && building.hp < building.max_hp;
  const faulty = building.runtime?.state === 'error' || building.runtime?.state === 'no_power';
  return damaged || faulty ? 'distressed' : 'normal';
}

// ---------- 调色板 ----------

interface ArchetypePalette {
  /** 主体结构受光面色。 */
  body: number;
  /** 主体结构背光/底部色。 */
  bodyDark: number;
  /** 点缀色（发光窗/顶球/箭头等）。 */
  accent: number;
}

const ARCHETYPE_PALETTE: Record<BuildingArchetype, ArchetypePalette> = {
  tower: { body: 0x8ba3bb, bodyDark: 0x55677c, accent: 0x9bd4ff },
  dome: { body: 0x9db8d9, bodyDark: 0x5d7492, accent: 0x7dd3fc },
  furnace: { body: 0x8a7460, bodyDark: 0x54463a, accent: 0xffb26b },
  depot: { body: 0xa08a66, bodyDark: 0x6a5a42, accent: 0xffd43b },
  belt: { body: 0x4a5462, bodyDark: 0x2e3642, accent: 0xffd43b },
  special: { body: 0x8296ab, bodyDark: 0x54667a, accent: 0x9bd4ff },
};

/** 同原型内按类型区分点缀色（保证地图上不同类型一眼可辨）。 */
const TYPE_ACCENT: Record<string, number> = {
  wind_turbine: 0xe8f4ff,
  tesla_tower: 0xffd43b,
  wireless_power_tower: 0x74c0fc,
  satellite_substation: 0x74c0fc,
  signal_tower: 0xffd43b,
  jammer_tower: 0xb197fc,
  laser_turret: 0xff8787,
  gauss_turret: 0xffa94d,
  missile_turret: 0xff8787,
  plasma_turret: 0xb197fc,
  sr_plasma_turret: 0xb197fc,
  implosion_cannon: 0xff6b6b,
  planetary_shield_generator: 0x63e6be,
  mining_machine: 0x48b589,
  advanced_mining_machine: 0x63e6be,
  oil_extractor: 0x9c8ade,
  water_pump: 0x74c0fc,
  orbital_collector: 0xffe066,
  em_rail_ejector: 0xfcd34d,
  vertical_launching_silo: 0xffa94d,
  matrix_lab: 0x7dd3fc,
  self_evolution_lab: 0xb197fc,
  battlefield_analysis_base: 0xc4b5fd,
  ray_receiver: 0xc4b5fd,
  artificial_star: 0xffe066,
  arc_smelter: 0xffa94d,
  negentropy_smelter: 0xb197fc,
  plane_smelter: 0xff8787,
  assembling_machine_mk1: 0x63e6be,
  assembling_machine_mk2: 0x63e6be,
  assembling_machine_mk3: 0x63e6be,
  recomposing_assembler: 0xb197fc,
  assembler: 0x63e6be,
  chemical_plant: 0x94d82d,
  quantum_chemical_plant: 0x94d82d,
  oil_refinery: 0xff8787,
  fractionator: 0xffa94d,
  thermal_power_plant: 0xff8787,
  mini_fusion_power_plant: 0xffe066,
  miniature_particle_collider: 0xb197fc,
  spray_coater: 0x94d82d,
  geothermal_power_station: 0xff922b,
  planetary_logistics_station: 0x4dd4fa,
  interstellar_logistics_station: 0x4dd4fa,
  logistics_distributor: 0x63e6be,
  depot_mk1: 0xffd43b,
  depot_mk2: 0xffd43b,
  storage_tank: 0x74c0fc,
  accumulator: 0xffe066,
  accumulator_full: 0xffe066,
  energy_exchanger: 0xffa94d,
};

export function resolveBuildingAccent(buildingType: string): number {
  return TYPE_ACCENT[buildingType] ?? ARCHETYPE_PALETTE[resolveBuildingArchetype(buildingType)].accent;
}

// ---------- 烘焙几何 ----------

/** 超采样：每 tile 烘焙像素数。 */
export const BUILDING_SPRITE_TILE_PX = 32;

export interface BuildingSpriteLayout {
  /** 画布尺寸（px）。 */
  canvasWidth: number;
  canvasHeight: number;
  /** footprint 在画布内的原点偏移（px）：场景侧 sprite.position = (-padX*s, -topExtra*s)。 */
  padX: number;
  topExtra: number;
  /** footprint 烘焙尺寸（px）。 */
  footprintWidth: number;
  footprintHeight: number;
}

/** 同 footprint 不同尺寸自适应：溢出量按 footprint 比例计算。 */
export function buildingSpriteLayout(tilesWide: number, tilesHigh: number): BuildingSpriteLayout {
  const fw = Math.max(tilesWide, 1) * BUILDING_SPRITE_TILE_PX;
  const fh = Math.max(tilesHigh, 1) * BUILDING_SPRITE_TILE_PX;
  const padX = Math.round(fw * 0.08) + 2;
  const topExtra = Math.round(fh * 0.55);
  const bottomExtra = Math.round(fh * 0.12) + 2;
  return {
    canvasWidth: fw + padX * 2,
    canvasHeight: fh + topExtra + bottomExtra,
    padX,
    topExtra,
    footprintWidth: fw,
    footprintHeight: fh,
  };
}

export function buildingSpriteCacheKey(
  archetype: BuildingArchetype,
  tilesWide: number,
  tilesHigh: number,
  state: BuildingVisualState,
): string {
  return `bldg:${archetype}:${tilesWide}x${tilesHigh}:${state}`;
}

/** 风机叶片烘焙缓存键。 */
export function windBladesCacheKey(tilesWide: number, tilesHigh: number): string {
  return `bldg-blades:${tilesWide}x${tilesHigh}`;
}

/** 是否需要旋转叶片（独立小 sprite，ticker 驱动）。 */
export function hasRotorBlades(buildingType: string): boolean {
  return buildingType === 'wind_turbine';
}

/** 叶片轮毂在 footprint 内的位置（比例）：场景侧换算容器坐标。 */
export const ROTOR_HUB_FRACTION = { x: 0.5, y: 0.1 } as const;

/** furnace 发光窗中心在 footprint 内的位置（比例）：场景侧呼吸辉光 sprite 对齐用。 */
export const FURNACE_GLOW_FRACTION = { x: 0.37, y: 0.52 } as const;

/** 该原型是否有呼吸发光窗。 */
export function hasGlowWindow(archetype: BuildingArchetype): boolean {
  return archetype === 'furnace';
}

// ---------- canvas 绘制 ----------

function numToCss(color: number, alpha = 1): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function fillVertical(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  topCss: string,
  bottomCss: string,
) {
  const gradient = ctx.createLinearGradient(0, y0, 0, y1);
  gradient.addColorStop(0, topCss);
  gradient.addColorStop(1, bottomCss);
  ctx.fillStyle = gradient;
  ctx.fill();
}

const OUTLINE = 'rgba(8, 12, 20, 0.85)';

/** 公共底座：投影（右下偏移半透明黑）+ 底座板（深色金属 + 顶面高光）。 */
function drawShadowAndBase(
  ctx: CanvasRenderingContext2D,
  layout: BuildingSpriteLayout,
) {
  const { padX, topExtra, footprintWidth: fw, footprintHeight: fh } = layout;
  const fx = padX;
  const fy = topExtra;

  ctx.fillStyle = 'rgba(3, 6, 12, 0.34)';
  ctx.beginPath();
  ctx.ellipse(fx + fw * 0.55, fy + fh * 0.93, fw * 0.48, fh * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  const plateX = fx + fw * 0.02;
  const plateY = fy + fh * 0.66;
  const plateW = fw * 0.96;
  const plateH = fh * 0.32;
  roundRectPath(ctx, plateX, plateY, plateW, plateH, Math.max(2, fh * 0.05));
  fillVertical(ctx, plateY, plateY + plateH, '#3d4a5c', '#222b38');
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.fillRect(plateX + 2, plateY + 1, plateW - 4, Math.max(1.5, fh * 0.03));

  return { plateX, plateY, plateW, plateH };
}

/** distressed 变体：整体暗化 + 底座板警示斜纹。 */
function applyDistressed(
  ctx: CanvasRenderingContext2D,
  layout: BuildingSpriteLayout,
  plate: { plateX: number; plateY: number; plateW: number; plateH: number },
) {
  ctx.fillStyle = 'rgba(8, 10, 18, 0.30)';
  ctx.fillRect(0, 0, layout.canvasWidth, layout.canvasHeight);

  ctx.save();
  roundRectPath(ctx, plate.plateX, plate.plateY, plate.plateW, plate.plateH, Math.max(2, plate.plateH * 0.2));
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 176, 32, 0.55)';
  ctx.lineWidth = Math.max(1.5, plate.plateH * 0.14);
  const step = Math.max(4, plate.plateH * 0.5);
  for (let x = plate.plateX - plate.plateH; x < plate.plateX + plate.plateW + plate.plateH; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, plate.plateY + plate.plateH + 1);
    ctx.lineTo(x + plate.plateH + 1, plate.plateY - 1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTower(ctx: CanvasRenderingContext2D, layout: BuildingSpriteLayout, palette: ArchetypePalette, buildingType: string) {
  const { padX, topExtra, footprintWidth: fw, footprintHeight: fh } = layout;
  const fx = padX;
  const fy = topExtra;
  const cx = fx + fw / 2;
  const baseY = fy + fh * 0.68;
  const topY = fy + fh * 0.1;
  const baseW = fw * 0.34;
  const topW = fw * 0.16;

  ctx.beginPath();
  ctx.moveTo(cx - baseW / 2, baseY);
  ctx.lineTo(cx + baseW / 2, baseY);
  ctx.lineTo(cx + topW / 2, topY);
  ctx.lineTo(cx - topW / 2, topY);
  ctx.closePath();
  fillVertical(ctx, topY, baseY, numToCss(palette.body), numToCss(palette.bodyDark));
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 塔筒节线
  ctx.strokeStyle = 'rgba(10, 16, 26, 0.4)';
  ctx.lineWidth = 1;
  for (const t of [0.35, 0.62]) {
    const y = topY + (baseY - topY) * t;
    const w = topW + (baseW - topW) * t;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, y);
    ctx.lineTo(cx + w / 2, y);
    ctx.stroke();
  }

  if (hasRotorBlades(buildingType)) {
    // 风机：机舱（叶片由场景侧独立 sprite 旋转）
    ctx.fillStyle = numToCss(palette.bodyDark);
    ctx.strokeStyle = OUTLINE;
    roundRectPath(ctx, cx - fw * 0.05, topY - fh * 0.03, fw * 0.16, fh * 0.07, 2);
    ctx.fill();
    ctx.stroke();
  } else {
    // 顶部平台 + 点缀球 + 光晕
    ctx.fillStyle = numToCss(palette.bodyDark);
    ctx.strokeStyle = OUTLINE;
    roundRectPath(ctx, cx - topW * 0.9, topY - 3, topW * 1.8, 4, 1.5);
    ctx.fill();
    ctx.stroke();

    const orbR = Math.max(2, fw * 0.08);
    const orbY = topY - 3 - orbR * 0.8;
    const glow = ctx.createRadialGradient(cx, orbY, 0, cx, orbY, orbR * 2.4);
    glow.addColorStop(0, numToCss(palette.accent, 0.5));
    glow.addColorStop(1, numToCss(palette.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(cx - orbR * 2.4, orbY - orbR * 2.4, orbR * 4.8, orbR * 4.8);

    ctx.beginPath();
    ctx.arc(cx, orbY, orbR, 0, Math.PI * 2);
    fillVertical(ctx, orbY - orbR, orbY + orbR, '#f4faff', numToCss(palette.accent));
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 底座上的 accent 铭牌
  ctx.fillStyle = numToCss(palette.accent, 0.9);
  ctx.fillRect(cx - fw * 0.1, baseY - fh * 0.05, fw * 0.2, Math.max(1.5, fh * 0.03));
}

function drawDome(ctx: CanvasRenderingContext2D, layout: BuildingSpriteLayout, palette: ArchetypePalette, buildingType: string) {
  const { padX, topExtra, footprintWidth: fw, footprintHeight: fh } = layout;
  const fx = padX;
  const fy = topExtra;
  const cx = fx + fw / 2;
  const domeR = Math.min(fw, fh) * 0.3;
  const domeCY = fy + fh * 0.68;

  // 穹顶辉光（baked 静态底光）
  const glow = ctx.createRadialGradient(cx, domeCY - domeR * 0.4, 0, cx, domeCY - domeR * 0.4, domeR * 1.9);
  glow.addColorStop(0, numToCss(palette.accent, 0.35));
  glow.addColorStop(1, numToCss(palette.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(cx - domeR * 1.9, domeCY - domeR * 2.3, domeR * 3.8, domeR * 3.8);

  // 底部环带
  ctx.fillStyle = numToCss(palette.bodyDark);
  ctx.strokeStyle = OUTLINE;
  roundRectPath(ctx, cx - domeR * 1.12, domeCY - fh * 0.05, domeR * 2.24, fh * 0.08, 2);
  ctx.fill();
  ctx.stroke();

  // 穹顶
  ctx.beginPath();
  ctx.arc(cx, domeCY, domeR, Math.PI, 0);
  ctx.closePath();
  fillVertical(ctx, domeCY - domeR, domeCY, '#e8f2ff', numToCss(palette.body));
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 穹顶经纬线
  ctx.strokeStyle = 'rgba(20, 32, 48, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, domeCY, domeR * 0.62, Math.PI, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, domeCY - domeR);
  ctx.lineTo(cx, domeCY);
  ctx.stroke();

  // 分析/接收类：顶部天线
  if (buildingType.includes('analysis') || buildingType.includes('receiver') || buildingType.includes('lab')) {
    const mastTop = domeCY - domeR - fh * 0.16;
    ctx.strokeStyle = numToCss(palette.bodyDark);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, domeCY - domeR + 1);
    ctx.lineTo(cx, mastTop);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, mastTop, Math.max(1.5, fw * 0.035), 0, Math.PI * 2);
    ctx.fillStyle = numToCss(palette.accent);
    ctx.fill();
  }
}

function drawFurnace(ctx: CanvasRenderingContext2D, layout: BuildingSpriteLayout, palette: ArchetypePalette) {
  const { padX, topExtra, footprintWidth: fw, footprintHeight: fh } = layout;
  const fx = padX;
  const fy = topExtra;

  // 烟囱（先画，压在炉体后）
  const chX = fx + fw * 0.64;
  const chW = fw * 0.14;
  const chTop = fy + fh * 0.08;
  const chBottom = fy + fh * 0.42;
  ctx.beginPath();
  ctx.rect(chX, chTop, chW, chBottom - chTop);
  fillVertical(ctx, chTop, chBottom, numToCss(palette.bodyDark), '#241d17');
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#1b1512';
  roundRectPath(ctx, chX - 2, chTop - 2, chW + 4, fh * 0.05, 1.5);
  ctx.fill();
  ctx.stroke();

  // 炉体
  const bx = fx + fw * 0.16;
  const bw = fw * 0.68;
  const by = fy + fh * 0.36;
  const bh = fy + fh * 0.68 - by;
  ctx.beginPath();
  ctx.rect(bx, by, bw, bh);
  fillVertical(ctx, by, by + bh, numToCss(palette.body), numToCss(palette.bodyDark));
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 顶檐
  ctx.fillStyle = numToCss(palette.bodyDark);
  roundRectPath(ctx, bx - 2, by - 3, bw + 4, fh * 0.06, 1.5);
  ctx.fill();
  ctx.stroke();

  // 发光窗（与 FURNACE_GLOW_FRACTION 对齐：中心 (0.37, 0.52)）
  const ww = fw * 0.26;
  const wh = fh * 0.12;
  const wx = fx + FURNACE_GLOW_FRACTION.x * fw - ww / 2;
  const wy = fy + FURNACE_GLOW_FRACTION.y * fh - wh / 2;
  const glow = ctx.createRadialGradient(wx + ww / 2, wy + wh / 2, 0, wx + ww / 2, wy + wh / 2, ww * 0.9);
  glow.addColorStop(0, numToCss(palette.accent, 0.55));
  glow.addColorStop(1, numToCss(palette.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(wx - ww * 0.4, wy - wh, ww * 1.8, wh * 3);
  roundRectPath(ctx, wx, wy, ww, wh, 1.5);
  fillVertical(ctx, wy, wy + wh, '#fff3d6', numToCss(palette.accent));
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawDepot(ctx: CanvasRenderingContext2D, layout: BuildingSpriteLayout, palette: ArchetypePalette, buildingType: string) {
  const { padX, topExtra, footprintWidth: fw, footprintHeight: fh } = layout;
  const fx = padX;
  const fy = topExtra;

  const bx = fx + fw * 0.1;
  const bw = fw * 0.8;
  const by = fy + fh * 0.42;
  const bh = fy + fh * 0.68 - by;

  // 屋顶（梯形斜顶）
  ctx.beginPath();
  ctx.moveTo(bx - fw * 0.04, by);
  ctx.lineTo(bx + bw * 0.08, by - fh * 0.16);
  ctx.lineTo(bx + bw * 0.92, by - fh * 0.16);
  ctx.lineTo(bx + bw + fw * 0.04, by);
  ctx.closePath();
  fillVertical(ctx, by - fh * 0.16, by, '#d9c9a8', numToCss(palette.body));
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 箱体
  ctx.beginPath();
  ctx.rect(bx, by, bw, bh);
  fillVertical(ctx, by, by + bh, numToCss(palette.body), numToCss(palette.bodyDark));
  ctx.stroke();

  // 箱门 + accent 条
  ctx.fillStyle = 'rgba(12, 16, 24, 0.55)';
  ctx.fillRect(bx + bw * 0.38, by + bh * 0.25, bw * 0.24, bh * 0.75);
  ctx.fillStyle = numToCss(palette.accent, 0.9);
  ctx.fillRect(bx + bw * 0.08, by + bh * 0.18, bw * 0.84, Math.max(1.5, bh * 0.12));

  // 物流站：天线杆 + 碟点
  if (buildingType.includes('logistics')) {
    const mastX = bx + bw * 0.85;
    const mastTop = by - fh * 0.34;
    ctx.strokeStyle = numToCss(palette.bodyDark);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mastX, by - fh * 0.14);
    ctx.lineTo(mastX, mastTop);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mastX, mastTop, Math.max(1.5, fw * 0.04), 0, Math.PI * 2);
    ctx.fillStyle = numToCss(palette.accent);
    ctx.fill();
  }
}

function drawBelt(ctx: CanvasRenderingContext2D, layout: BuildingSpriteLayout, palette: ArchetypePalette) {
  const { padX, topExtra, footprintWidth: fw, footprintHeight: fh } = layout;
  const fx = padX;
  const fy = topExtra;

  const bx = fx + fw * 0.02;
  const bw = fw * 0.96;
  const by = fy + fh * 0.44;
  const bh = fh * 0.24;

  ctx.beginPath();
  ctx.rect(bx, by, bw, bh);
  fillVertical(ctx, by, by + bh, numToCss(palette.body), numToCss(palette.bodyDark));
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 上下钢轨
  ctx.fillStyle = '#77839a';
  ctx.fillRect(bx, by, bw, Math.max(1.5, bh * 0.18));
  ctx.fillRect(bx, by + bh - Math.max(1.5, bh * 0.18), bw, Math.max(1.5, bh * 0.18));

  // 方向箭头纹（chevron → +x）
  ctx.fillStyle = numToCss(palette.accent, 0.85);
  const chevronW = fw * 0.12;
  const count = Math.max(2, Math.round(fw / (chevronW * 1.8)));
  for (let i = 0; i < count; i += 1) {
    const cx = bx + bw * ((i + 0.5) / count);
    const cy = by + bh / 2;
    ctx.beginPath();
    ctx.moveTo(cx - chevronW * 0.4, cy - bh * 0.26);
    ctx.lineTo(cx + chevronW * 0.4, cy);
    ctx.lineTo(cx - chevronW * 0.4, cy + bh * 0.26);
    ctx.lineTo(cx - chevronW * 0.1, cy);
    ctx.closePath();
    ctx.fill();
  }
}

function drawSpecial(ctx: CanvasRenderingContext2D, layout: BuildingSpriteLayout, palette: ArchetypePalette) {
  const { padX, topExtra, footprintWidth: fw, footprintHeight: fh } = layout;
  const fx = padX;
  const fy = topExtra;

  const bx = fx + fw * 0.18;
  const bw = fw * 0.64;
  const by = fy + fh * 0.4;
  const bh = fy + fh * 0.68 - by;

  ctx.beginPath();
  ctx.rect(bx, by, bw, bh);
  fillVertical(ctx, by, by + bh, numToCss(palette.body), numToCss(palette.bodyDark));
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 小屋顶
  ctx.beginPath();
  ctx.moveTo(bx - fw * 0.03, by);
  ctx.lineTo(bx + bw * 0.5, by - fh * 0.14);
  ctx.lineTo(bx + bw + fw * 0.03, by);
  ctx.closePath();
  fillVertical(ctx, by - fh * 0.14, by, '#c6d4e2', numToCss(palette.body));
  ctx.stroke();

  // 中心 accent 圆点
  ctx.beginPath();
  ctx.arc(bx + bw / 2, by + bh * 0.45, Math.max(2, fw * 0.06), 0, Math.PI * 2);
  ctx.fillStyle = numToCss(palette.accent);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ---------- 纹理缓存 ----------

const cache = new Map<string, Texture>();

export interface BuildingSpriteSpec {
  archetype: BuildingArchetype;
  buildingType: string;
  tilesWide: number;
  tilesHigh: number;
  state: BuildingVisualState;
}

function renderBuildingCanvas(spec: BuildingSpriteSpec): HTMLCanvasElement {
  const layout = buildingSpriteLayout(spec.tilesWide, spec.tilesHigh);
  const canvas = document.createElement('canvas');
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas 2d context unavailable');
  }

  const base = ARCHETYPE_PALETTE[spec.archetype];
  const palette: ArchetypePalette = { ...base, accent: resolveBuildingAccent(spec.buildingType) };

  const plate = drawShadowAndBase(ctx, layout);
  switch (spec.archetype) {
    case 'tower':
      drawTower(ctx, layout, palette, spec.buildingType);
      break;
    case 'dome':
      drawDome(ctx, layout, palette, spec.buildingType);
      break;
    case 'furnace':
      drawFurnace(ctx, layout, palette);
      break;
    case 'depot':
      drawDepot(ctx, layout, palette, spec.buildingType);
      break;
    case 'belt':
      drawBelt(ctx, layout, palette);
      break;
    case 'special':
      drawSpecial(ctx, layout, palette);
      break;
  }
  if (spec.state === 'distressed') {
    applyDistressed(ctx, layout, plate);
  }
  return canvas;
}

/** 建筑结构精灵纹理（全局缓存；纹理生命周期由本模块管理，场景不得 destroy）。 */
export function getBuildingSpriteTexture(spec: BuildingSpriteSpec): Texture {
  const key = buildingSpriteCacheKey(spec.archetype, spec.tilesWide, spec.tilesHigh, spec.state);
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const texture = Texture.from(renderBuildingCanvas(spec));
  texture.source.scaleMode = 'linear';
  cache.set(key, texture);
  return texture;
}

/** 风机叶片纹理：轮毂居中，三叶 120° 分布（0 相位时一叶朝正上）。 */
export function getWindBladesTexture(tilesWide: number, tilesHigh: number): Texture {
  const key = windBladesCacheKey(tilesWide, tilesHigh);
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const layout = buildingSpriteLayout(tilesWide, tilesHigh);
  const d = Math.round(Math.max(layout.footprintWidth, layout.footprintHeight) * 0.78);
  const canvas = document.createElement('canvas');
  canvas.width = d;
  canvas.height = d;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas 2d context unavailable');
  }
  const c = d / 2;
  for (let i = 0; i < 3; i += 1) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate((i * 2 * Math.PI) / 3);
    ctx.beginPath();
    ctx.moveTo(-d * 0.05, -d * 0.05);
    ctx.lineTo(d * 0.05, -d * 0.05);
    ctx.lineTo(d * 0.016, -d * 0.47);
    ctx.lineTo(-d * 0.016, -d * 0.47);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, -d * 0.05, 0, -d * 0.47);
    gradient.addColorStop(0, '#f4f9ff');
    gradient.addColorStop(1, '#b9c8d8');
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(c, c, Math.max(2, d * 0.07), 0, Math.PI * 2);
  ctx.fillStyle = '#e8eef5';
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'linear';
  cache.set(key, texture);
  return texture;
}

/** 测试/热重载时清空缓存（与 engine/textures 的纪律一致）。 */
export function clearBuildingSpriteCache() {
  cache.forEach((texture) => texture.destroy(true));
  cache.clear();
}
