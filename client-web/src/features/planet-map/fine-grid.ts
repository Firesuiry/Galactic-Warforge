/**
 * 细分网格（§4）常量与几何工具。
 *
 * 服务端把原来的 1 格（tile）细分成 3×3 个小格（cell），坐标系仍是一套整数
 * Position，只是单位变成 cell（见 docs/guide/细分网格与DSP界面.md §1）。
 * 客户端因此：
 * - 建筑按 catalog footprint（1×1/2×2/3×3/5×5 cell）真实占地绘制；
 * - 传送带/分拣器/电线杆/单位是 1 cell 小件，视觉比例接近戴森球计划；
 * - 2D 缩放档整体按 cell 重排（默认 16px/cell，一格建筑约 48px）。
 */

/** 旧 1 tile = 3×3 cell（仅用于文案/换算说明，坐标本身已全量是 cell）。 */
export const CELL_PER_LEGACY_TILE = 3;

/** 网格线加粗周期（cell）：每 3 cell（= 旧 1 格）一条更亮的线，保留旧格感知。 */
export const GRID_MAJOR_CELL = 3;

/** 3D 场景里 1 cell 的世界尺寸占比：建筑模型按 footprint × 0.86 摆放，留 14% 缝隙。 */
export const CELL_FILL_RATIO = 0.86;
