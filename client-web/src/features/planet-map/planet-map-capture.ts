/**
 * 行星地图截图捕获句柄：替代旧 PlanetMapCanvas 透出的 HTMLCanvasElement。
 * - clientWidth/clientHeight：分享链接/视口 JSON 的视口换算（等价旧 canvas.clientWidth）。
 * - captureScreenshot：把当前画面（2D 的 Pixi 舞台 / 3D 的 WebGL 画布）抓成 canvas 供 PNG 导出。
 *
 * 第 20 轮从 PlanetMapPixi.tsx 迁出：2D 视图退役后 3D（PlanetMapThree）与调试面板
 * 仍然共用这个接口，放在视图组件里会让「3D 依赖 2D 文件」的引用关系继续存在。
 */
export interface PlanetMapCapture {
  clientWidth: number;
  clientHeight: number;
  captureScreenshot: () => HTMLCanvasElement | null;
}
