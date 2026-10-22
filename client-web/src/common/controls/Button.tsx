import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

import { sfx } from '@/engine/audio';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 视觉变体：primary 主行动 / secondary 次行动 / danger 危险行动。 */
  variant?: ButtonVariant;
  /** 尺寸：md 默认（表单主行动），sm 紧凑（卡片/抽屉内）。 */
  size?: ButtonSize;
  /** 可选 lucide 图标插槽（渲染在文字前，装饰性 aria-hidden）。 */
  icon?: LucideIcon;
  /** 点击音（默认 uiClick；静音/无 AudioContext 自动 no-op）。 */
  silent?: boolean;
  /** 悬停音（默认开，引擎 50ms 限流；触屏/静音自动 no-op）。 */
  silentHover?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'primary-button',
  secondary: 'secondary-button',
  danger: 'danger-button',
};

/**
 * 全息按钮（期3 控件库）。受控语义与原生 button 一致（type 默认 "button"，提交传 type="submit"），
 * 皮肤复用 .primary-button/.secondary-button 体系，danger 为新增变体（样式见 components.css 控件库区）。
 */
export function Button({
  variant = 'primary',
  size = 'md',
  icon: IconGlyph,
  className,
  children,
  type = 'button',
  silent = false,
  silentHover = false,
  onClick,
  onPointerEnter,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        VARIANT_CLASS[variant],
        size === 'sm' ? 'sw-btn--sm' : '',
        className,
      ].filter(Boolean).join(' ')}
      onPointerEnter={(event) => {
        // 悬停音只在指针设备上响（touch 的 pointerenter 会跟着点击一起触发）。
        if (!silentHover && event.pointerType !== 'touch') sfx.uiHover();
        onPointerEnter?.(event);
      }}
      onClick={(event) => {
        // 统一控件库的点击音（第 23 轮音频）：只接主要按钮组件，不逐个按钮改。
        if (!silent && !event.defaultPrevented) sfx.uiClick();
        onClick?.(event);
      }}
      {...rest}
    >
      {IconGlyph ? <IconGlyph size={size === 'sm' ? 14 : 16} strokeWidth={2} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
