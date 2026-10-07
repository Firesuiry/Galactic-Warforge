import { useEffect, useState } from 'react';

import type { SquadScreenPoint } from '@/features/planet-map/PlanetSquadLayer';

type ProjectTile = (tile: { x: number; y: number }) => SquadScreenPoint | null;

const PROBES = [{ x: 0, y: 0 }, { x: 7, y: 3 }];

/**
 * 3D 叠加层的投影刷新：逐帧探测相机投影，只有画面视角真的变化时才重渲染
 * （原先每帧无条件 setState，交战时 3 个叠加层每帧都重渲染）。
 * active=false（无可画内容）时不跑循环。
 */
export function useProjectionFrame(projectTile: ProjectTile | undefined, active: boolean): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!projectTile || !active) return undefined;
    let raf = 0;
    let last = '';
    const loop = () => {
      const signature = PROBES.map((tile) => {
        const point = projectTile(tile);
        return point ? `${point.x.toFixed(1)},${point.y.toFixed(1)}` : '-';
      }).join('|');
      if (signature !== last) {
        last = signature;
        setFrame((value) => value + 1);
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [projectTile, active]);
  return frame;
}
