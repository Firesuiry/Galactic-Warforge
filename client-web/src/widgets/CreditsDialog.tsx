import { useEffect, useState } from 'react';

import { X } from 'lucide-react';

/**
 * 鸣谢弹窗（第 23 轮 3A）：列出第三方素材与许可。
 *
 * 数据来自 `public/assets/credits.json`（由 `node develop_tools/three_assets/credits.mjs` 生成，
 * 源是 `develop_tools/sketchfab/selection.json` + 下载时的许可记录 + 音频/贴图的 THIRD_PARTY.md）。
 * CC-BY 素材必须署名，所以这里逐个列标题、作者、模型页与改动说明；CC0 一并列出便于核对。
 */

interface CreditEntry {
  type: string;
  title: string;
  author: string;
  authorUrl: string;
  modelUrl: string;
  license: string;
  licenseUrl: string;
  changes: string;
}

interface CreditGroup {
  id: string;
  title: string;
  entries: CreditEntry[];
}

interface CreditsData {
  note: string;
  groups: CreditGroup[];
}

/** 模块级缓存：弹窗反复开关不重复请求（素材清单随构建固定）。 */
let cached: Promise<CreditsData | null> | null = null;

function loadCredits(): Promise<CreditsData | null> {
  cached ??= fetch('/assets/credits.json')
    .then((response) => (response.ok ? response.json() as Promise<CreditsData> : null))
    .catch(() => null);
  return cached;
}

export function CreditsDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<CreditsData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadCredits().then((value) => {
      if (!alive) return;
      if (value) setData(value);
      else setFailed(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="credits-backdrop" onClick={onClose} role="presentation">
      <section
        aria-label="鸣谢"
        className="credits-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="credits-dialog__header">
          <h2 className="credits-dialog__title">鸣谢</h2>
          <button aria-label="关闭鸣谢" className="top-nav__icon-btn" onClick={onClose} type="button">
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>
        {data?.note ? <p className="credits-dialog__note">{data.note}</p> : null}
        {failed ? <p className="credits-dialog__note">素材清单加载失败（assets/credits.json 不可用）。</p> : null}
        {!data && !failed ? <p className="credits-dialog__note">加载中…</p> : null}
        <div className="credits-dialog__body">
          {data?.groups.map((group) => (
            <section className="credits-group" key={group.id}>
              <h3 className="credits-group__title">{group.title}</h3>
              <ul className="credits-group__list">
                {group.entries.map((entry) => (
                  <li className="credits-entry" key={`${group.id}:${entry.type}`}>
                    <div className="credits-entry__head">
                      <a className="credits-entry__title" href={entry.modelUrl} rel="noreferrer noopener" target="_blank">
                        {entry.title}
                      </a>
                      <span className="credits-entry__license">{entry.license}</span>
                    </div>
                    <div className="credits-entry__meta">
                      <a href={entry.authorUrl} rel="noreferrer noopener" target="_blank">{entry.author}</a>
                      <span className="credits-entry__type">{entry.type}</span>
                    </div>
                    {entry.changes ? <div className="credits-entry__changes">改动：{entry.changes}</div> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
