/** 新手引导面板：步骤清单 + 当前步骤提示 + 黑雾说明，可折叠；完成后只留黑雾敌对警示。 */

import { useState } from 'react';

import type { WarGuideState } from '@/features/onboarding/war-guide';

export function WarGuidePanel({ guide }: { guide: WarGuideState }) {
  const [collapsed, setCollapsed] = useState(false);
  if (guide.complete) {
    return guide.notice?.tone === 'danger' ? <p className="war-guide-notice war-guide-notice--danger" role="alert">{guide.notice.text}</p> : null;
  }
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
          {guide.shortage ? (
            <div className="war-guide-shortage" data-testid="war-guide-shortage">
              <p className="war-guide-shortage__total">{guide.shortage.text}</p>
              <ul>
                {guide.shortage.sources.map((source) => (
                  <li key={source.itemId}>
                    {source.source ? `${source.itemName}：${source.source}` : source.itemName}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {guide.notice ? (
            <p className={`war-guide-notice war-guide-notice--${guide.notice.tone}`} role={guide.notice.tone === 'danger' ? 'alert' : undefined}>
              {guide.notice.text}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
