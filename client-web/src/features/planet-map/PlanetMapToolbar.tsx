import { useEffect, useRef, useState } from "react";

import { useShallow } from "zustand/react/shallow";

import type { PlanetNetworksView, PlanetRuntimeView } from "@shared/types";

import type { PlanetRenderView } from "@/features/planet-map/model";
import { PlanetLayerPanel } from "@/features/planet-map/PlanetPanels";
import { usePlanetViewStore } from "@/features/planet-map/store";

interface PlanetMapToolbarProps {
  networks?: PlanetNetworksView;
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
}

/**
 * 左下悬浮工具条（V3 全屏布局）：默认一列小图标按钮，
 * ☰ 弹出浮层承载原左栏内容（12 图层勾选 + 缩放档位 + 场景摘要，组件原样复用）。
 * 缩放 ± 与档位按钮统一走 store 的 requestZoom（锚点 = 视口中心），渲染层补间由场景负责。
 */
export function PlanetMapToolbar({
  networks,
  planet,
  runtime,
}: PlanetMapToolbarProps) {
  const { camera, requestZoom, resetCamera } = usePlanetViewStore(
    useShallow((state) => ({
      camera: state.camera,
      requestZoom: state.requestZoom,
      resetCamera: state.resetCamera,
    })),
  );
  const [panelOpen, setPanelOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

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
      <div className="planet-map-toolbar__rail">
        <button
          aria-expanded={panelOpen}
          aria-label="图层与视角"
          className="secondary-button planet-map-toolbar__button"
          onClick={() => setPanelOpen((open) => !open)}
          title="图层与视角"
          type="button"
        >
          <span aria-hidden="true">☰</span>
        </button>
        <button
          aria-label="缩小"
          className="secondary-button planet-map-toolbar__button"
          onClick={() => requestZoom(camera.zoomIndex - 1)}
          title="缩小"
          type="button"
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          aria-label="放大"
          className="secondary-button planet-map-toolbar__button"
          onClick={() => requestZoom(camera.zoomIndex + 1)}
          title="放大"
          type="button"
        >
          <span aria-hidden="true">＋</span>
        </button>
        <button
          aria-label="重置视角"
          className="secondary-button planet-map-toolbar__button"
          onClick={resetCamera}
          title="重置视角"
          type="button"
        >
          <span aria-hidden="true">⌂</span>
        </button>
      </div>
    </div>
  );
}
