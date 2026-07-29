import type { InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

/**
 * 全息输入框（期3 控件库）：text/number 通用受控组件，语义与原生 input 一致，
 * 保留 name/aria-label/disabled/inputMode；type="checkbox" 时渲染全息勾选框（.sw-checkbox）。
 */
export function Input({ className, type = 'text', ...rest }: InputProps) {
  const baseClass = type === 'checkbox' ? 'sw-checkbox' : 'sw-input';
  return (
    <input
      type={type}
      className={[baseClass, className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
