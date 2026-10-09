import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlanetRenderView } from '@/features/planet-map/model';
import { PlanetMinimap } from '@/features/planet-map/PlanetMinimap';
import { resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { MINI_CSS, computeLayout } from '@/features/planet-map/minimap-geometry';
import { useSessionStore } from '@/stores/session';

/**
 * 缩略图右键下令（试玩 1011 #2「远处下令太难」）：
 * 右键缩略图必须走与主地图右键同一条 contextTile 路径，落在正确的 tile 上，
 * 没有选中单位时给出提示而不是静默。
 */

function makePlanet(): PlanetRenderView {
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    surface: { topology: 'cube_sphere' as const, face_size: 32 },
    map_width: 96,
    map_height: 64,
    tick: 10,
    terrain: Array.from({ length: 64 }, () => Array.from({ length: 96 }, () => 'buildable')),
    buildings: {},
    units: {},
    resources: [],
  } as unknown as PlanetRenderView;
}

/** 缩略图 canvas 的 getBoundingClientRect 在 jsdom 里恒为 0：补一个 152×152 的框。 */
function stubCanvasRect(canvas: HTMLCanvasElement) {
  canvas.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: MINI_CSS, bottom: MINI_CSS,
    width: MINI_CSS, height: MINI_CSS, toJSON: () => ({}),
  }) as DOMRect;
}

function clickAt(canvas: HTMLCanvasElement, tileX: number, tileY: number, type: 'contextmenu' | 'click') {
  const layout = computeLayout(96, 64);
  const clientX = layout.offsetX + (tileX + 0.5) * layout.scale;
  const clientY = layout.offsetY + (tileY + 0.5) * layout.scale;
  if (type === 'contextmenu') {
    fireEvent.contextMenu(canvas, { clientX, clientY });
  } else {
    fireEvent.click(canvas, { clientX, clientY });
  }
}

describe('PlanetMinimap 右键下令', () => {
  beforeEach(() => {
    resetPlanetViewStore();
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
  });

  it('右键缩略图把该格交给 contextTile（与主地图同一条命令路径）', () => {
    const onContextTile = vi.fn((_tile: { x: number; y: number }) => true);
    render(<PlanetMinimap fog={makePlanet()} onContextTile={onContextTile} planet={makePlanet()} />);
    const canvas = screen.getByLabelText('行星缩略地图') as HTMLCanvasElement;
    stubCanvasRect(canvas);

    clickAt(canvas, 10, 20, 'contextmenu');

    expect(onContextTile).toHaveBeenCalledTimes(1);
    expect(onContextTile.mock.calls[0][0]).toEqual({ x: 10, y: 20 });
  });

  it('右键缩略图始终阻止浏览器默认菜单', () => {
    render(<PlanetMinimap fog={makePlanet()} planet={makePlanet()} />);
    const canvas = screen.getByLabelText('行星缩略地图') as HTMLCanvasElement;
    stubCanvasRect(canvas);

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('无选中单位时给出本地提示（contextTile 返回 false）', () => {
    const onContextTile = vi.fn(() => false);
    const onOrderBlocked = vi.fn();
    render(
      <PlanetMinimap
        fog={makePlanet()}
        onContextTile={onContextTile}
        onOrderBlocked={onOrderBlocked}
        planet={makePlanet()}
      />,
    );
    const canvas = screen.getByLabelText('行星缩略地图') as HTMLCanvasElement;
    stubCanvasRect(canvas);

    clickAt(canvas, 3, 4, 'contextmenu');

    expect(onOrderBlocked).toHaveBeenCalledTimes(1);
    expect(onOrderBlocked.mock.calls[0][0]).toContain('没有选中的己方单位');
    expect(onOrderBlocked.mock.calls[0][1]).toEqual({ x: 3, y: 4 });
  });

  it('攻击移动交互模式下右键缩略图走 attackMove 而不是普通移动', () => {
    const onContextTile = vi.fn((_tile: { x: number; y: number }) => true);
    const onAttackMove = vi.fn(() => true);
    usePlanetViewStore.getState().setInteractionMode({ kind: 'unit_order', order: 'attack_move' });
    render(
      <PlanetMinimap
        fog={makePlanet()}
        onAttackMove={onAttackMove}
        onContextTile={onContextTile}
        planet={makePlanet()}
      />,
    );
    const canvas = screen.getByLabelText('行星缩略地图') as HTMLCanvasElement;
    stubCanvasRect(canvas);

    clickAt(canvas, 7, 8, 'contextmenu');

    expect(onAttackMove).toHaveBeenCalledWith({ x: 7, y: 8 });
    expect(onContextTile).not.toHaveBeenCalled();
  });

  it('左键仍是移镜头（requestFocus），不影响右键下令', () => {
    const onContextTile = vi.fn((_tile: { x: number; y: number }) => true);
    render(<PlanetMinimap fog={makePlanet()} onContextTile={onContextTile} planet={makePlanet()} />);
    const canvas = screen.getByLabelText('行星缩略地图') as HTMLCanvasElement;
    stubCanvasRect(canvas);

    clickAt(canvas, 12, 13, 'click');
    expect(usePlanetViewStore.getState().focusRequest?.position).toMatchObject({ x: 12, y: 13 });
    expect(onContextTile).not.toHaveBeenCalled();
  });

  it('hover 显示坐标（与主地图 hover 同口径）', () => {
    render(<PlanetMinimap fog={makePlanet()} planet={makePlanet()} />);
    const canvas = screen.getByLabelText('行星缩略地图') as HTMLCanvasElement;
    stubCanvasRect(canvas);

    const layout = computeLayout(96, 64);
    fireEvent.mouseMove(canvas, {
      clientX: layout.offsetX + 5.5 * layout.scale,
      clientY: layout.offsetY + 6.5 * layout.scale,
    });
    expect(screen.getByText('5, 6')).toBeInTheDocument();
    fireEvent.mouseLeave(canvas);
    expect(screen.getByText('缩略')).toBeInTheDocument();
  });
});
