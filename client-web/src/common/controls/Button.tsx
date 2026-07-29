import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 视觉变体：primary 主行动 / secondary 次行动 / danger 危险行动。 */
  variant?: ButtonVariant;
  /** 尺寸：md 默认（表单主行动），sm 紧凑（卡片/抽屉内）。 */
  size?: ButtonSize;
  /** 可选 lucide 图标插槽（渲染在文字前，装饰性 aria-hidden）。 */
  icon?: LucideIcon;
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
      {...rest}
    >
      {IconGlyph ? <IconGlyph size={size === 'sm' ? 14 : 16} strokeWidth={2} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
