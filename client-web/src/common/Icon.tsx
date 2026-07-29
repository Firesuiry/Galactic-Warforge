import type { CSSProperties } from 'react';

import { Icon as LucideIconBase } from 'lucide-react';

import { resolveIconNode } from '@/common/icon-map';

/**
 * Icon：统一的"彩色圆角方块底 + lucide 线稿字形"图标组件（期2 图标体系）。
 *
 * - 通过 `iconKey`（来自 catalog.icon_key）查 lucide 节点数据（common/icon-map，全站唯一事实来源）；
 *   未命中则回退首字母大写。
 * - `color`（来自 catalog.color）既作字形描边色（currentColor），也转低透明 rgba 作容器底色与微光描边；
 *   未给则用 --accent 主色。
 * - `size` 控制容器边长（默认 24），字形跟随 size（约 0.62 倍）。
 * - 装饰性图标默认 `aria-hidden`；若提供 `label` 则 `role="img"` + `aria-label`。
 */

export interface IconProps {
  iconKey?: string;
  color?: string;
  size?: number;
  /** 为 true 时不写死 width/height，交给 CSS 控制（用于地图实体节点随 tile 缩放）。 */
  fluid?: boolean;
  /** 提供时图标变为带语义的 img；否则视为装饰性（aria-hidden）。 */
  label?: string;
  className?: string;
}

/** 主色（与 --accent #39e6d0 对应），color 缺失/无法解析时的底色与字形回退。 */
const ACCENT_RGB: readonly [number, number, number] = [57, 230, 208];
const ACCENT_CSS = '#39e6d0';

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

/** 未命中映射时的字母回退（与原 emoji 版行为一致）。 */
function resolveFallbackLetter(iconKey: string | undefined): string {
  if (iconKey && iconKey.length > 0) return iconKey.charAt(0).toUpperCase();
  return '?';
}

export function Icon({ iconKey, color, size = 24, fluid = false, label, className }: IconProps) {
  const node = resolveIconNode(iconKey);
  const glyphColor = color ?? ACCENT_CSS;
  const style: CSSProperties = {
    background: colorToRgba(color, 0.16),
    borderColor: colorToRgba(color, 0.4),
    boxShadow: `0 0 6px ${colorToRgba(color, 0.22)}`,
    color: glyphColor,
    ...(fluid
      ? {}
      : { width: size, height: size, fontSize: Math.round(size * 0.56) }),
  };
  const a11y = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': true as const };

  return (
    <span className={['sw-icon', className].filter(Boolean).join(' ')} style={style} {...a11y}>
      {node ? (
        <LucideIconBase
          iconNode={node}
          size={fluid ? '62%' : Math.round(size * 0.62)}
          strokeWidth={2}
          aria-hidden="true"
        />
      ) : (
        <span aria-hidden="true">{resolveFallbackLetter(iconKey)}</span>
      )}
    </span>
  );
}
