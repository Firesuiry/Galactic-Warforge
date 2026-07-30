import type { TextareaHTMLAttributes } from 'react';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

/**
 * 全息多行输入（期7 控件库补全）：受控语义与原生 textarea 一致，
 * 保留 rows/aria-label/disabled；皮肤与 sw-input 同族（.sw-textarea）。
 */
export function Textarea({ className, ...rest }: TextareaProps) {
  return (
    <textarea
      className={['sw-textarea', className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
