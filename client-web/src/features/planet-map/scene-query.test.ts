import { describe, expect, it } from 'vitest';

import { buildPlanetSceneRequest } from './scene-query';

describe('scene request bounds', () => {
  it('boots without an unverified surface center before atlas dimensions arrive', () => {
    expect(buildPlanetSceneRequest({ x: 0, y: 0, width: 96, height: 64 }))
      .toEqual({ x: 0, y: 0, width: 96, height: 64 });
  });

  it('clips the default window and center to a face-size-16 atlas', () => {
    expect(buildPlanetSceneRequest(
      { x: 0, y: 0, width: 96, height: 64 },
      { map_width: 48, map_height: 32 },
    )).toEqual({ x: 0, y: 0, width: 48, height: 32, near_x: 24, near_y: 16, radius: 64 });
  });

  it('clips a stale camera window at either map edge', () => {
    expect(buildPlanetSceneRequest(
      { x: 999, y: -100, width: 16, height: 16 },
      { map_width: 48, map_height: 32 },
    )).toEqual({ x: 32, y: 0, width: 16, height: 16, near_x: 40, near_y: 8, radius: 64 });
  });
});
