import type { CSSProperties } from 'react';

/**
 * Icon：统一的"彩色圆角方块底 + emoji 字形"图标组件（V0 设计地基）。
 *
 * - 通过 `iconKey`（来自 catalog.icon_key）查 emoji 字形；未命中则回退首字母大写。
 * - `color`（来自 catalog.color）转低透明 rgba 作容器底色；未给则用 --accent 低透明。
 * - `size` 控制容器边长（默认 24），字号跟随 size。
 * - 装饰性图标默认 `aria-hidden`；若提供 `label` 则 `role="img"` + `aria-label`。
 * - 零运行时依赖（纯 emoji）。V4 会把实体节点/chip/按钮接到此组件。
 */

export interface IconProps {
  iconKey?: string;
  color?: string;
  size?: number;
  /** 为 true 时不写死 width/height/fontSize，交给 CSS 控制（用于地图实体节点随 tile 缩放）。 */
  fluid?: boolean;
  /** 提供时图标变为带语义的 img；否则视为装饰性（aria-hidden）。 */
  label?: string;
  className?: string;
}

/** iconKey → emoji 字形映射。覆盖建筑/资源/单位的核心 catalog key（含常见别名）。 */
const ICON_MAP: Record<string, string> = {
  // 建筑 —— 采集 / 生产 / 能源 / 科研 / 物流 / 戴森球
  mining_machine: '⛏️',
  miner: '⛏️',
  assembling_machine_mk1: '🛠️',
  assembler: '🛠️',
  tesla_tower: '⚡',
  tesla: '⚡',
  lab: '🧪',
  research_station: '🧪',
  logistics_station: '📡',
  em_rail_ejector: '🛰️',
  vertical_launching_silo: '🚀',
  ray_receiver: '🔭',
  artificial_star: '✨',
  // 资源
  iron_ore: '🪨',
  copper_ore: '🟠',
  coal: '⚫',
  stone: '⬜',
  oil: '🛢️',
  silicon_ore: '🔵',
  water: '💧',
  gear: '⚙️',
  // 单位
  worker: '👷',
  soldier: '🪖',
  executor: '🤖',
};

/** 主色 RGB（与 --accent #39e6d0 对应），color 缺失/无法解析时的底色回退。 */
const ACCENT_RGB: readonly [number, number, number] = [57, 230, 208];

function parseHex(hex: string): [number, number, number] | null {
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

function parseRgbFunctional(s: string): [number, number, number] | null {
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (!m) return null;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  return [r, g, b];
}

/** 把任意 color 字符串转成指定 alpha 的 rgba；无法解析时回退到 accent。 */
function colorToRgba(color: string | undefined, alpha: number): string {
  const [r, g, b] = color
    ? parseHex(color) ?? parseRgbFunctional(color) ?? ACCENT_RGB
    : ACCENT_RGB;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function resolveGlyph(iconKey: string | undefined): string {
  if (iconKey && ICON_MAP[iconKey]) return ICON_MAP[iconKey];
  if (iconKey && iconKey.length > 0) return iconKey.charAt(0).toUpperCase();
  return '?';
}

export function Icon({ iconKey, color, size = 24, fluid = false, label, className }: IconProps) {
  const glyph = resolveGlyph(iconKey);
  const style: CSSProperties = fluid
    ? { background: colorToRgba(color, 0.18) }
    : {
        width: size,
        height: size,
        fontSize: Math.round(size * 0.56),
        background: colorToRgba(color, 0.18),
      };
  const a11y = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': true as const };

  return (
    <span className={['sw-icon', className].filter(Boolean).join(' ')} style={style} {...a11y}>
      <span aria-hidden="true">{glyph}</span>
    </span>
  );
}
