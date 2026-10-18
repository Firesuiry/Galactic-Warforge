// cp-belt-dsp 标准机位：基地南侧多层传送带立体交叉（第 19 轮 §5）。
//
// 场景要素（坐标见 docs/guide/checkpoints/cp-belt-dsp.json）：
//   铜主线 y=153 地面 x=48..56；铁线 x=53 y=151..155，其中 (53,152)(53,153) 在 1 层跨过铜线；
//   侧汇支带 (48,152)(49,152) → (50,152) 转南汇入；跨格分拣器 (53,157) 背面扫 2 格取 (53,155) 带。
//
// 机位约定（与主代理第 19 轮手写片段 /tmp/r19-real/r1..r5.js 对齐）：
//   overview       (53,154) zoom 1.2              —— 场景全貌
//   cross-diag     (53,153) tilt 1.15 zoom 2.0，绕 Z 转 -π/4 —— 立交斜视
//   cross-side     (53,153) tilt 1.15 zoom 2.0，绕 Z 转 +π/2 —— 立交侧视（看清高差）
//   span-sorter    (53,156) tilt 1.0 zoom 2.4     —— 跨格分拣器 + 带尾
//   merge          (49,153)                       —— 侧汇支线汇入主线
//   特写：cross 与 span-sorter 各一张 2x（裁剪整屏中心再放大）
export default {
  title: 'cp-belt-dsp 多层传送带立体交叉',
  checkpoint: 'cp-belt-dsp',
  settleTicks: 50,
  shots: [
    { name: 'overview', kind: '3d', focus: { x: 53, y: 154 }, zoom: 1.2, settleMs: 2500 },
    {
      name: 'cross-diag', kind: '3d', focus: { x: 53, y: 153 },
      tilt: 1.15, zoom: 2.0, rotateZ: -Math.PI / 4, settleMs: 2000,
      closeup: { cx: 600, cy: 470, w: 560, h: 440 },
    },
    {
      name: 'cross-side', kind: '3d', focus: { x: 53, y: 153 },
      tilt: 1.15, zoom: 2.0, rotateZ: Math.PI / 2, settleMs: 2000,
      closeup: { cx: 600, cy: 470, w: 560, h: 440 },
    },
    {
      name: 'span-sorter', kind: '3d', focus: { x: 53, y: 156 },
      tilt: 1.0, zoom: 2.4, settleMs: 2200,
      closeup: { cx: 600, cy: 500, w: 520, h: 420 },
    },
    { name: 'merge', kind: '3d', focus: { x: 49, y: 153 }, settleMs: 2000 },
  ],
};
