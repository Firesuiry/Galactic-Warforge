import type { LucideIcon } from 'lucide-react';

export interface HoloTabItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: HoloTabItem[];
  activeId: string;
  onChange: (id: string) => void;
  /** tablist 的 aria-label（如「战争工作台面板」）。 */
  ariaLabel: string;
  /**
   * 提供时 tab 元素 id 取 `${idPrefix}-tab-${id}`、aria-controls 取 `${idPrefix}-panel-${id}`，
   * 与对应面板的 id 约定配套（如 war 抽屉的 war-drawer-panel-*）。
   */
  idPrefix?: string;
  className?: string;
}

/**
 * 全息图标 Tab（期3 控件库）：图标 + 可选文字，active 态 teal 描边/底色 + 微光。
 * 受控组件：activeId/onChange 由外部持有；role=tablist/tab + aria-selected 语义齐全，
 * 用于抽屉/卡片切换（战争工作台抽屉等）。
 */
export function Tabs({ tabs, activeId, onChange, ariaLabel, idPrefix, className }: TabsProps) {
  return (
    <div className={['sw-tabs', className].filter(Boolean).join(' ')} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            id={idPrefix ? `${idPrefix}-tab-${tab.id}` : undefined}
            className={`sw-tabs__tab${active ? ' sw-tabs__tab--active' : ''}`}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon ? <tab.icon size={16} strokeWidth={2} aria-hidden="true" /> : null}
            <span className="sw-tabs__text">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
