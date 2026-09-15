import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { CatalogView, FogMapView, PlanetNetworksView, PlanetOverviewView, PlanetRuntimeView, PlanetSceneView } from '@shared/types';
import type { PlanetMapCapture } from './PlanetMapPixi';
import { PLANET_LAYER_LABELS, getFogState, resolveHomeTile, resolveSelectionAtTile, type PlanetLayerKey, type PlanetRenderView, type TilePoint } from './model';
import { usePlanetViewStore } from './store';
import { PlanetThreeScene } from './planet-three-scene';
import type { PlanetRenderQuality } from './three/render-quality';
import { useSessionSnapshot } from '@/hooks/use-session';

const QUALITY_STORAGE_KEY = 'siliconworld-planet-quality';

function readQuality(): PlanetRenderQuality {
  const query = new URLSearchParams(window.location.search).get('quality');
  if (query === 'low' || query === 'balanced' || query === 'high') return query;
  try {
    const saved = localStorage.getItem(QUALITY_STORAGE_KEY);
    if (saved === 'low' || saved === 'balanced' || saved === 'high') return saved;
  } catch { /* Storage can be disabled; rendering still works. */ }
  return 'balanced';
}

interface Props {
  planet: PlanetRenderView;
  catalog?: CatalogView;
  fog?: FogMapView | PlanetSceneView;
  overview?: PlanetOverviewView;
  networks?: PlanetNetworksView;
  runtime?: PlanetRuntimeView;
  onCanvasReady?: (capture: PlanetMapCapture | null) => void;
  onInteractTile?: (tile: TilePoint) => void;
}

export function PlanetMapThree(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<PlanetThreeScene | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const session = useSessionSnapshot();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [tilt, setTilt] = useState(0.65);
  const [quality, setQuality] = useState<PlanetRenderQuality>(readQuality);
  const { selected, hoveredTile, interactionMode, layers, focusRequest } = usePlanetViewStore(useShallow(s => ({
    selected: s.selected, hoveredTile: s.hoveredTile, interactionMode: s.interactionMode,
    layers: s.layers, focusRequest: s.focusRequest,
  })));

  useEffect(() => {
    const cancelInteraction = (event: KeyboardEvent) => {
      if (event.key === 'Escape') usePlanetViewStore.getState().exitInteractionMode();
    };
    window.addEventListener('keydown', cancelInteraction);
    return () => window.removeEventListener('keydown', cancelInteraction);
  }, []);

  useEffect(() => {
    if (!host.current) return;
    let renderer: PlanetThreeScene;
    try {
      renderer = new PlanetThreeScene(host.current, tile => {
        const current = latest.current;
        const store = usePlanetViewStore.getState();
        const fog = current.fog;
        if (fog && !getFogState(fog, tile.x, tile.y).visible) {
          store.requestFocus(tile);
          return;
        }
        if (store.interactionMode.kind !== 'inspect') current.onInteractTile?.(tile);
        else store.setSelected(resolveSelectionAtTile(current.planet, tile.x, tile.y)
          ?? { kind: 'tile', position: { ...tile, z: 0 } });
      }, tile => usePlanetViewStore.getState().setHoveredTile(tile));
    } catch {
      setError('无法启动 3D 画面，请启用浏览器硬件加速，或切换到平面战术视图。');
      return;
    }
    scene.current = renderer;
    setReady(true);
    // Dev-only projection helper: browser tests still click the rendered canvas.
    if (import.meta.env.DEV) (window as unknown as { __planetThree?: PlanetThreeScene }).__planetThree = renderer;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const tile = renderer.getCenterTile();
      if (!tile) return;
      const { planet } = latest.current;
      const width = Math.min(96, planet.map_width);
      const height = Math.min(96, planet.map_height);
      const next = {
        x: Math.max(0, Math.min(planet.map_width - width, Math.floor(tile.x - width / 2))),
        y: Math.max(0, Math.min(planet.map_height - height, Math.floor(tile.y - height / 2))), width, height,
      };
      const store = usePlanetViewStore.getState();
      if (Math.abs(next.x - store.sceneWindow.x) >= 24 || Math.abs(next.y - store.sceneWindow.y) >= 24
        || width !== store.sceneWindow.width || height !== store.sceneWindow.height) store.setSceneWindow(next);
    }, 500);
    return () => {
      clearInterval(timer);
      renderer.destroy();
      scene.current = null;
      latest.current.onCanvasReady?.(null);
      if (import.meta.env.DEV) delete (window as unknown as { __planetThree?: PlanetThreeScene }).__planetThree;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    scene.current?.setData({ ...props, playerId: session.playerId });
  }, [ready, props.planet, props.fog, props.overview, props.catalog, props.runtime, props.networks, session.playerId]);

  useEffect(() => {
    if (ready) scene.current?.setQuality(quality);
  }, [ready, quality]);

  useEffect(() => {
    if (!ready || !scene.current || !host.current) return;
    const element = host.current;
    props.onCanvasReady?.({
      get clientWidth() { return element.clientWidth; },
      get clientHeight() { return element.clientHeight; },
      captureScreenshot: () => scene.current?.capture() ?? null,
    });
  }, [ready, props.onCanvasReady]);

  useEffect(() => {
    scene.current?.setInteraction({ selected, hoveredTile, interactionMode, layers });
  }, [ready, selected, hoveredTile, interactionMode, layers]);

  const initiallyFocused = useRef(false);
  useEffect(() => {
    if (!ready || !focusRequest) return;
    scene.current?.focus(focusRequest.position, initiallyFocused.current);
    initiallyFocused.current = true;
    usePlanetViewStore.getState().consumeFocusRequest(focusRequest.nonce);
  }, [ready, focusRequest]);

  const home = () => {
    const tile = resolveHomeTile(props.planet, session.playerId);
    if (tile) scene.current?.focus(tile);
  };

  return <div className="planet-three" onContextMenu={event => {
    event.preventDefault();
    usePlanetViewStore.getState().exitInteractionMode();
  }}>
    <div ref={host} className="planet-three__surface" tabIndex={0} role="application" aria-label="3D 行星地图" />
    {error && <div role="alert" className="planet-three__error">{error}</div>}
    <div className="planet-three__navigation" aria-label="3D 视角控制">
      <div>
        <button className="secondary-button" onClick={() => scene.current?.orbit()}>全球视角</button>
        <button className="secondary-button" onClick={home}>聚焦基地</button>
        <button className="secondary-button" aria-label="3D 放大" onClick={() => scene.current?.zoom(1.4)}>＋</button>
        <button className="secondary-button" aria-label="3D 缩小" onClick={() => scene.current?.zoom(1 / 1.4)}>−</button>
      </div>
      <label className="planet-three__tilt">镜头俯仰
        <input aria-label="镜头俯仰" type="range" min="0" max="1.1" step="0.05" value={tilt}
          onChange={event => { const value = Number(event.target.value); setTilt(value); scene.current?.setTilt(value); }} />
      </label>
      <label className="planet-three__quality">画面质量
        <select aria-label="画面质量" value={quality} onChange={event => {
          const next = event.target.value as PlanetRenderQuality;
          setQuality(next);
          try { localStorage.setItem(QUALITY_STORAGE_KEY, next); } catch { /* Optional preference. */ }
        }}>
          <option value="low">流畅</option>
          <option value="balanced">均衡</option>
          <option value="high">精细</option>
        </select>
      </label>
      <details className="planet-three__layers">
        <summary>显示图层</summary>
        <div>{(['buildings', 'units', 'resources', 'logistics', 'power', 'pipelines', 'construction', 'threat', 'grid'] satisfies PlanetLayerKey[]).map(layer => <label key={layer}>
          <input type="checkbox" checked={layers[layer]} onChange={event => usePlanetViewStore.getState().setLayers({ [layer]: event.target.checked })} />
          {PLANET_LAYER_LABELS[layer]}
        </label>)}</div>
      </details>
      {hoveredTile && <small>{hoveredTile.x}, {hoveredTile.y}</small>}
      {interactionMode.kind !== 'inspect' && <button className="secondary-button" onClick={() => usePlanetViewStore.getState().exitInteractionMode()}>取消{interactionMode.kind === 'build' ? '建造' : interactionMode.kind === 'move' ? '移动' : '攻击'} · Esc</button>}
    </div>
  </div>;
}
