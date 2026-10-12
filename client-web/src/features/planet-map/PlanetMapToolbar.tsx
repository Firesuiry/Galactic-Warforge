import { useEffect, useRef, useState, type ReactNode } from "react";

import { Bug, Crosshair, House, Layers, Minus, Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import type { PlanetNetworksView, PlanetRuntimeView } from "@shared/types";

import type { PlanetRenderView } from "@/features/planet-map/model";
import { resolveHomeTile } from "@/features/planet-map/model";
import { PlanetLayerPanel } from "@/features/planet-map/PlanetPanels";
import {
  PLANET_FOCUS_FIT_ZOOM,
  usePlanetViewStore,
} from "@/features/planet-map/store";
import { useHudRailTop } from "@/features/planet-map/use-hud-rail-top";
import { useSessionSnapshot } from "@/hooks/use-session";

interface PlanetMapToolbarProps {
  /** 3D 球面视图：3D 有自己的导航列（全球视角/聚焦基地/缩放/图层/选中对象/视角设置），
      这里整个不渲染——过去两列同时出现在左下角，图标重复且互相压住（§3.2 复核）。 */
  dimensional?: boolean;
  networks?: PlanetNetworksView;
  /** 打开右侧抽屉的「选中对象」页签（抽屉打开时底部选择条会被让位，这里给一个固定入口）。 */
  onOpenSelection?: () => void;
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
  /** 追加到图标列**末尾**的按钮（战区划定）。同一列 = 一个视觉整体：
      过去战区是紧贴这一列右侧的第二列，两个绝对定位的列很难对齐（§3.2 复核）。 */
  children?: ReactNode;
}

/**
 * 左下悬浮工具条（V3 全屏布局）：默认一列小图标按钮，
 * 图层按钮弹出浮层承载原左栏内容（12 图层勾选 + 缩放档位 + 场景摘要，组件原样复用）。
 * 缩放 ± 与档位按钮统一走 store 的 requestZoom（锚点 = 视口中心），渲染层补间由场景负责。
 * "回到基地"：居中到玩家基地并自适应占屏（小行星整图 60-80%，大行星维持 48px/tile 回家档）；
 * 找不到基地时退回重置视角。
 *
 * 「调试」也收进这一列（§3.2 复核）：过去它在顶部中右侧单独挂一个文字按钮，
 * 在地图上非常突兀；现在与其他相机/图层图标同一视觉语言，面板浮在这一列上方。
 * 面板与底部状态行都要知道「这一列有多高」，所以这里把实测高度写进
 * --planet-hud-rail-top（见 use-hud-rail-top.ts）。
 *
 * 3D 下整条不渲染：3D 的 PlanetMapThree 自带同构的一列（且带 3D 专属的全球视角/视角设置）。
 */
export function PlanetMapToolbar({
  children,
  dimensional = false,
  networks,
  onOpenSelection,
  planet,
  runtime,
}: PlanetMapToolbarProps) {
  const { camera, debugOpen, requestZoom, requestFocus, resetCamera, toggleDebugOpen } = usePlanetViewStore(
    useShallow((state) => ({
      camera: state.camera,
      debugOpen: state.debugOpen,
      requestZoom: state.requestZoom,
      requestFocus: state.requestFocus,
      resetCamera: state.resetCamera,
      toggleDebugOpen: state.toggleDebugOpen,
    })),
  );
  const session = useSessionSnapshot();
  const [panelOpen, setPanelOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  useHudRailTop(railRef, [dimensional, onOpenSelection, planet.planet_id]);

  useEffect(() => {
    if (!panelOpen) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPanelOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [panelOpen]);

  const handleHome = () => {
    const home = usePlanetViewStore.getState().homeTile ?? resolveHomeTile(planet, session.playerId);
    if (home) {
      requestFocus(home, PLANET_FOCUS_FIT_ZOOM);
    } else {
      resetCamera();
    }
  };

  // 3D 有自己的导航列（PlanetMapThree），这条 2D 工具条整条不渲染。
  if (dimensional) {
    return null;
  }

  return (
    <div className="planet-map-toolbar" ref={rootRef}>
      {panelOpen ? (
        <div className="panel planet-map-toolbar__popover">
          <PlanetLayerPanel
            networks={networks}
            planet={planet}
            runtime={runtime}
          />
        </div>
      ) : null}
      <div className="planet-map-toolbar__rail" ref={railRef}>
        {/* 调试排在最上：展开的面板与底部状态行都浮在这一列上方，
            调试图标在最上面时面板顶边位置与 rail 顶边一致，几何最稳。 */}
        <button
          aria-expanded={debugOpen}
          aria-label={debugOpen ? "收起调试" : "展开调试"}
          className="secondary-button planet-map-toolbar__button"
          onClick={() => toggleDebugOpen()}
          title={debugOpen ? "收起调试" : "展开调试"}
          type="button"
        >
          <Bug size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          aria-expanded={panelOpen}
          aria-label="图层与视角"
          className="secondary-button planet-map-toolbar__button"
          onClick={() => setPanelOpen((open) => !open)}
          title="图层与视角"
          type="button"
        >
          <Layers size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          aria-label="缩小"
          className="secondary-button planet-map-toolbar__button"
          onClick={() => requestZoom(camera.zoomIndex - 1)}
          title="缩小"
          type="button"
        >
          <Minus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          aria-label="放大"
          className="secondary-button planet-map-toolbar__button"
          onClick={() => requestZoom(camera.zoomIndex + 1)}
          title="放大"
          type="button"
        >
          <Plus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          aria-label="回到基地"
          className="secondary-button planet-map-toolbar__button"
          onClick={handleHome}
          title="回到基地"
          type="button"
        >
          <House size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        {onOpenSelection ? (
          <button
            aria-label="选中对象"
            className="secondary-button planet-map-toolbar__button"
            onClick={onOpenSelection}
            title="选中对象"
            type="button"
          >
            <Crosshair size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
