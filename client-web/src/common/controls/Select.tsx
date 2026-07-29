import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

/**
 * 全息下拉（期3 控件库）：原生 select + 深度定制皮肤（appearance:none + 自定义箭头），
 * 不自造弹出层，option 行为/无障碍与原生一致（getByLabel/selectOption 等选择器不受影响）。
 * 受控用法与原生 select 相同（value + onChange），保留 name/aria-label/disabled。
 */
export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <span className={['sw-select', className].filter(Boolean).join(' ')}>
      <select className="sw-select__native" {...rest}>
        {children}
      </select>
      <ChevronDown className="sw-select__chevron" size={14} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}
