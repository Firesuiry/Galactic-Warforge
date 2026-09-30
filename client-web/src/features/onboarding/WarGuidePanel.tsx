/** C9 新手引导面板：显示 6 步清单与当前步骤提示，可折叠。 */

import { useState } from 'react';

import type { WarGuideState } from '@/features/onboarding/war-guide';

export function WarGuidePanel({ guide }: { guide: WarGuideState }) {
  const [collapsed, setCollapsed] = useState(false);
  if (guide.complete) return null;
  return (
    <section aria-label="新手引导" className="war-guide-panel" data-testid="war-guide-panel">
      <header>
        <strong>新手引导 {guide.currentIndex + 1}/{guide.steps.length}</strong>
        <button
          aria-expanded={!collapsed}
          className="secondary-button"
          onClick={() => setCollapsed((v) => !v)}
          type="button"
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </header>
      {collapsed ? null : (
        <>
          <ol>
            {guide.steps.map((step, index) => (
              <li
                aria-current={index === guide.currentIndex ? 'step' : undefined}
                className={step.done ? 'is-done' : index === guide.currentIndex ? 'is-current' : ''}
                data-step={step.id}
                key={step.id}
              >
                {step.done ? '✓ ' : ''}{step.label}
              </li>
            ))}
          </ol>
          <p data-testid="war-guide-hint">{guide.current?.hint}</p>
        </>
      )}
    </section>
  );
}
