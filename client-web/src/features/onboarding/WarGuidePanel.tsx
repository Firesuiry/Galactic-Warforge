/** 新手引导面板：默认收成一行（当前步骤标题 + 进度 n/9），点开看步骤清单/提示/缺料；完成后只留黑雾敌对警示。 */

import { useState } from 'react';

import type { WarGuideState } from '@/features/onboarding/war-guide';

export function WarGuidePanel({ guide }: { guide: WarGuideState }) {
  // §3.2：默认收起成一行（当前步骤标题 + 进度 n/9）——新手引导常驻在左上，
  // 展开态会把地图左上角盖掉一大块。收起态仍带当前步骤与进度，信息不丢。
  const [collapsed, setCollapsed] = useState(true);
  if (guide.complete) {
    return guide.notice?.tone === 'danger' ? <p className="war-guide-notice war-guide-notice--danger" role="alert">{guide.notice.text}</p> : null;
  }
  const progress = `${guide.currentIndex + 1}/${guide.steps.length}`;
  return (
    <section aria-label="新手引导" className="war-guide-panel" data-testid="war-guide-panel">
      <header>
        <strong>
          新手引导
          <span className="war-guide-panel__step">{guide.current?.label}</span>
          <span className="war-guide-panel__progress">{progress}</span>
        </strong>
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
