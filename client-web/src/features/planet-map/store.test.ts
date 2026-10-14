import {
  getPlanetRenderTileSize,
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
  it('8×6 小图在 1440×900 视口下选 32px/cell（占屏 64%，最接近 70% 目标）', () => {
    // 细分网格后最高 scene 档是 32px/cell：候选 24px → 43%，32px → 64%（0.7 目标的最优可行解）。
    expect(resolvePlanetFitZoomIndex(1440, 900, 8, 6)).toBe(sceneZoomIndexByTileSize(32));
  });

  it('288×288 遭遇战行星：初始视图对准基地，且每格 ≥ 16px（3×3 建筑 ≥ 48px 看得清）', () => {
    // 试玩 1015 §6-7：旧逻辑只看「整图入视口 + 70% 占屏」，288×288 会选到 3px/cell
    // （整图 864px 占 60%），3×3 建筑只有 9px，看不出建的是什么。现在有 16px/cell 下限，
    // 取景交给「聚焦基地 + 围绕视口的场景窗口」，分辨率优先。
    const index = resolvePlanetFitZoomIndex(1440, 900, 288, 288);
    expect(index).toBe(PLANET_HOME_ZOOM_INDEX);
    const tileSize = getPlanetRenderTileSize(index, 1440, 900, 288, 288);
    expect(tileSize).toBeGreaterThanOrEqual(16);
    // 3×3 建筑在屏幕上至少 48px 宽——一眼能认出是熔炉还是制造台。
    expect(tileSize * 3).toBeGreaterThanOrEqual(48);
  });

  it('大图在任何视口下都维持回家档（不因新增下限而改变既有行为）', () => {
    for (const [w, h] of [[1440, 900], [390, 844], [2560, 1440]] as const) {
      expect(resolvePlanetFitZoomIndex(w, h, 288, 288)).toBe(PLANET_HOME_ZOOM_INDEX);
    }
  });

  it('20×12 中图选 32px/cell 档（占屏 71%，最接近 70% 目标）', () => {
    // 候选：24px → 480×288 占屏 53%，32px → 640×384 占屏 71%（最优可行解）。
    expect(resolvePlanetFitZoomIndex(1440, 900, 20, 12)).toBe(sceneZoomIndexByTileSize(32));
  });

  it('移动端窄视口（390×844）：8×6 选 32px/cell（256×192 占屏 66%，仍整图入视口）', () => {
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
