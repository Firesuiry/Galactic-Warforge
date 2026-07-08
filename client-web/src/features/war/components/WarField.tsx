import type { ReactNode } from 'react';

/**
 * 战争表单的统一字段包装：`<label className="war-field"><span>标签</span>控件</label>`。
 *
 * label 包裹控件实现隐式关联，使测试的 getByLabelText('标签') 能稳定命中，
 * 也保证 WarPage 既有表单与新表单的视觉与无障碍口径一致。
 */
export function WarField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="war-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
