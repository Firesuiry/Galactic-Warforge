/**
 * 行星地图截图捕获句柄：替代旧 PlanetMapCanvas 透出的 HTMLCanvasElement。
 * - clientWidth/clientHeight：分享链接/视口 JSON 的视口换算（等价旧 canvas.clientWidth）。
 * - captureScreenshot：把当前画面（2D 的 Pixi 舞台 / 3D 的 WebGL 画布）抓成 canvas 供 PNG 导出。
 * - getViewport：3D 按需读取相机状态（调试面板打开/点「复制链接」时调用，不在挂载时上报一次）。
 *
 * 第 20 轮从 PlanetMapPixi.tsx 迁出：2D 视图退役后 3D（PlanetMapThree）与调试面板
 * 仍然共用这个接口，放在视图组件里会让「3D 依赖 2D 文件」的引用关系继续存在。
 */

/**
 * 3D 相机视口快照（R20-A ④）：调试面板的分享链接/视口 JSON 在 3D 下按
 * 「中心格 + zoom + tilt」导出，不再用 2D 的 tileSize/offset 视口矩形。
 */
export interface PlanetThreeViewportSnapshot {
  center: { x: number; y: number } | null;
  /** 相机高度（世界单位，与 2D 的 tileSize 同为「缩放」量纲）。 */
  altitude: number;
  tilt: number;
  width: number;
  height: number;
}

export interface PlanetMapCapture {
  clientWidth: number;
  clientHeight: number;
  captureScreenshot: () => HTMLCanvasElement | null;
  /** 3D 场景按需读取相机状态；2D / 未就绪时为 undefined。 */
  getViewport?: () => PlanetThreeViewportSnapshot | null;
}
