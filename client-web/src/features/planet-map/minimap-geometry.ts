/**
 * 缩略图几何：与 React 组件解耦，便于单测覆盖「右键缩略图 → tile」的坐标换算。
 * 坐标换算正确与否直接决定右键下令落在哪一格，因此单独成模块并加断言。
 */

/** 缩略图 CSS 边长（与 PlanetMinimap 一致）。 */
export const MINI_CSS = 152;

export interface MinimapLayout {
  scale: number;
  offsetX: number;
  offsetY: number;
  drawWidth: number;
  drawHeight: number;
}

/** 地图等比缩放进 MINI_CSS 方块，居中留边。 */
export function computeLayout(mapWidth: number, mapHeight: number): MinimapLayout {
  const scale = Math.min(MINI_CSS / Math.max(mapWidth, 1), MINI_CSS / Math.max(mapHeight, 1));
  const drawWidth = mapWidth * scale;
  const drawHeight = mapHeight * scale;
  return {
    scale,
    drawWidth,
    drawHeight,
    offsetX: (MINI_CSS - drawWidth) / 2,
    offsetY: (MINI_CSS - drawHeight) / 2,
  };
}

/**
 * 缩略图内的 CSS 坐标（相对 canvas 左上角，0..MINI_CSS）→ tile。
 * 越界（留边区域或地图外）返回 null，调用侧据此忽略本次点击/右键。
 */
export function miniTileAt(
  cssX: number,
  cssY: number,
  layout: MinimapLayout,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } | null {
  if (mapWidth <= 0 || mapHeight <= 0) {
    return null;
  }
  const { scale, offsetX, offsetY } = layout;
  if (scale <= 0) {
    return null;
  }
  const tx = Math.floor((cssX - offsetX) / scale);
  const ty = Math.floor((cssY - offsetY) / scale);
  if (tx < 0 || ty < 0 || tx >= mapWidth || ty >= mapHeight) {
    return null;
  }
  return { x: tx, y: ty };
}
