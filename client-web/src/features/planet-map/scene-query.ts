import type { PlanetSceneParams } from '@shared/api';
import type { PlanetSceneView } from '@shared/types';

import type { PlanetSceneWindow } from './store';

export function buildPlanetSceneRequest(
  window: PlanetSceneWindow,
  planet?: Pick<PlanetSceneView, 'map_width' | 'map_height'>,
): PlanetSceneParams {
  // Before the first response we do not know the atlas size. The server can
  // clip a rectangular window, but rejects an out-of-bounds surface center.
  if (!planet) return { ...window };

  const width = Math.min(window.width, planet.map_width);
  const height = Math.min(window.height, planet.map_height);
  const x = Math.max(0, Math.min(window.x, planet.map_width - width));
  const y = Math.max(0, Math.min(window.y, planet.map_height - height));
  return {
    x, y, width, height,
    near_x: Math.floor(x + width / 2),
    near_y: Math.floor(y + height / 2),
    radius: 64,
  };
}
