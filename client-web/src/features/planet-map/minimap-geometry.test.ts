import { describe, expect, it } from 'vitest';

import { MINI_CSS, computeLayout, miniTileAt } from './minimap-geometry';

describe('缩略图几何（右键下令的坐标换算）', () => {
  it('方形地图等比铺满且不留边', () => {
    const layout = computeLayout(96, 96);
    expect(layout.scale).toBeCloseTo(MINI_CSS / 96, 6);
    expect(layout.offsetX).toBeCloseTo(0, 6);
    expect(layout.offsetY).toBeCloseTo(0, 6);
  });

  it('非方形地图居中留边，留边区域不产生 tile', () => {
    // 288x192（face_size 96 的立方体球展开）：横向铺满、纵向上下留边。
    const layout = computeLayout(288, 192);
    expect(layout.drawWidth).toBeCloseTo(MINI_CSS, 6);
    expect(layout.drawHeight).toBeLessThan(MINI_CSS);
    expect(layout.offsetX).toBeCloseTo(0, 6);
    expect(layout.offsetY).toBeGreaterThan(0);

    // 正中一行任意位置都是有效 tile。
    expect(miniTileAt(MINI_CSS / 2, MINI_CSS / 2, layout, 288, 192)).toEqual({ x: 144, y: 96 });
    // 上留边（y < offsetY）返回 null，避免点空白区触发 requestFocus / 右键下令。
    expect(miniTileAt(MINI_CSS / 2, layout.offsetY / 2, layout, 288, 192)).toBeNull();
    expect(miniTileAt(MINI_CSS / 2, MINI_CSS - layout.offsetY / 2, layout, 288, 192)).toBeNull();
  });

  it('四角映射到地图四角 tile', () => {
    const layout = computeLayout(96, 96);
    const scale = layout.scale;
    const last = 96 * scale - 0.001;
    expect(miniTileAt(0.001, 0.001, layout, 96, 96)).toEqual({ x: 0, y: 0 });
    expect(miniTileAt(last, last, layout, 96, 96)).toEqual({ x: 95, y: 95 });
  });

  it('窄条地图（左右留边）在留边内不产生 tile', () => {
    // 48x96：纵向铺满，横向左右留边。
    const layout = computeLayout(48, 96);
    expect(layout.drawHeight).toBeCloseTo(MINI_CSS, 6);
    expect(layout.drawWidth).toBeLessThan(MINI_CSS);
    expect(layout.offsetX).toBeGreaterThan(0);
    expect(miniTileAt(layout.offsetX / 2, MINI_CSS / 2, layout, 48, 96)).toBeNull();
    expect(miniTileAt(MINI_CSS - layout.offsetX / 2, MINI_CSS / 2, layout, 48, 96)).toBeNull();
    expect(miniTileAt(MINI_CSS / 2, MINI_CSS / 2, layout, 48, 96)).toEqual({ x: 24, y: 48 });
  });

  it('地图尺寸非法时返回 null 而不是抛异常', () => {
    const layout = computeLayout(0, 0);
    expect(miniTileAt(10, 10, layout, 0, 0)).toBeNull();
    expect(computeLayout(0, 0).scale).toBeGreaterThan(0);
  });
});
