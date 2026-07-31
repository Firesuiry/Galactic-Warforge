import {
  PLANET_FOCUS_FIT_ZOOM,
  PLANET_HOME_ZOOM_INDEX,
  PLANET_ZOOM_LEVELS,
  resetPlanetViewStore,
  resolvePlanetFitZoomIndex,
  usePlanetViewStore,
} from '@/features/planet-map/store';

/** 找到指定 tileSize 的 scene 档 index（校验用，避免硬编码档位序号）。 */
function sceneZoomIndexByTileSize(tileSize: number) {
  return PLANET_ZOOM_LEVELS.findIndex(
    (level) => level.mode === 'scene' && level.tileSize === tileSize,
  );
}

describe('resolvePlanetFitZoomIndex：小行星初始相机自适应占屏', () => {
  it('8×6 小图在 1440×900 视口下选 96px/tile（占屏 64%，最接近 70% 目标）', () => {
    // 候选：64px → 43%，96px → 64%，128px → 85%；最接近 0.7 的是 96px。
    expect(resolvePlanetFitZoomIndex(1440, 900, 8, 6)).toBe(sceneZoomIndexByTileSize(96));
  });

  it('48×48 大图在回家档（48px）已超视口 → 行为不变返回回家档', () => {
    expect(resolvePlanetFitZoomIndex(1440, 900, 48, 48)).toBe(PLANET_HOME_ZOOM_INDEX);
  });

  it('20×12 中图选 48px 档（占屏 67%，最接近 70% 目标）', () => {
    // 候选：48px → 960×576 占屏 67%，64px → 1280×768 占屏 89%；最接近 0.7 的是 48px。
    expect(resolvePlanetFitZoomIndex(1440, 900, 20, 12)).toBe(sceneZoomIndexByTileSize(48));
  });

  it('移动端窄视口（390×844）：8×6 选 32px（48px 会超出视口宽）', () => {
    // 48px → 384×288 占屏 99%（过满），32px → 256×192 占屏 66%。
    expect(resolvePlanetFitZoomIndex(390, 844, 8, 6)).toBe(sceneZoomIndexByTileSize(32));
  });

  it('没有任何档位能整图入视口时返回 fallback', () => {
    expect(resolvePlanetFitZoomIndex(200, 200, 500, 500, 6)).toBe(6);
  });

  it('非法输入（零尺寸）返回 fallback', () => {
    expect(resolvePlanetFitZoomIndex(0, 900, 8, 6)).toBe(PLANET_HOME_ZOOM_INDEX);
    expect(resolvePlanetFitZoomIndex(1440, 900, 0, 6)).toBe(PLANET_HOME_ZOOM_INDEX);
  });
});

describe('requestFocus：PLANET_FOCUS_FIT_ZOOM 哨兵', () => {
  beforeEach(() => {
    resetPlanetViewStore();
  });

  it('哨兵原样透传（不被档位钳制吃掉）', () => {
    usePlanetViewStore.getState().requestFocus({ x: 1, y: 2 }, PLANET_FOCUS_FIT_ZOOM);
    expect(usePlanetViewStore.getState().focusRequest?.zoomIndex).toBe(PLANET_FOCUS_FIT_ZOOM);
  });

  it('普通档位仍然钳到合法区间', () => {
    usePlanetViewStore.getState().requestFocus({ x: 1, y: 2 }, 999);
    expect(usePlanetViewStore.getState().focusRequest?.zoomIndex).toBe(PLANET_ZOOM_LEVELS.length - 1);
  });
});
