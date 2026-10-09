import type { ReactNode } from "react";

interface MapDrawerProps {
  /** 边缘把手文案（同时作为 aria-label/title），如「工作台」。 */
  label: string;
  open: boolean;
  onToggle: () => void;
  /** 追加在抽屉体上的页面级类名（如战争页的加宽样式）。 */
  bodyClassName?: string;
  /**
   * 让出底部选择条：窄屏下抽屉是覆盖式的，抽屉体若铺满整高会盖住底部选择条
   * （选择条的「详情/移动」等按钮点不到）。为 true 时抽屉体底部留出选择条高度，
   * 由 planet.css 的 `--planet-bottom-reserve` 统一定义（宽屏选择条已右移让位，留 0）。
   */
  reserveBottom?: boolean;
  children: ReactNode;
}

/**
 * 全屏地图页共用的右侧工作台抽屉（期5a 行星页范式，期6a 抽共用）：
 * 默认收起为右缘把手，open 时抽屉体滑出（覆盖式，不挤压地图）。
 * 样式类沿用 styles/index.css 的 .planet-drawer 系列（行星页/战争页共用）。
 */
export function MapDrawer({
  label,
  open,
  onToggle,
  bodyClassName,
  reserveBottom = false,
  children,
}: MapDrawerProps) {
  return (
    <aside className={open ? "planet-drawer planet-drawer--open" : "planet-drawer"}>
      <button
        aria-expanded={open}
        aria-label={label}
        className="planet-drawer__handle"
        onClick={onToggle}
        title={label}
        type="button"
      >
        <span aria-hidden="true" className="planet-drawer__handle-text">
          {label}
        </span>
      </button>
      <div
        className={[
          "panel planet-detail-shell planet-drawer__body",
          bodyClassName ?? "",
          reserveBottom ? "planet-drawer__body--reserve-bottom" : "",
        ].filter(Boolean).join(" ")}
      >
        {children}
      </div>
    </aside>
  );
}
