// cp-post-attack 标准机位：首攻后的战场（敌军 / 己方步兵 / 防御工事同框）。
//
// 存档点见 docs/guide/checkpoints/README.md：cp-post-attack 停在 62000，bot 首攻已发生，
// 后续波次可能已在路上；这里取基地西南方向的交战区，机位与 cp-army 的 industry-overview 同一
// 缩放档，便于对照模型尺寸。
//
// 机位约定：
//   battle-wide   (56,144) tilt 0.55 zoom 0.62 —— 战场全貌（基地 + 敌军来袭方向）
//   battle-close  (56,144) tilt 0.85 zoom 1.6  —— 近距离看单位轮廓与炮塔
//   特写：battle-close 2x
export default {
  title: 'cp-post-attack 首攻后战场',
  checkpoint: 'cp-post-attack',
  settleTicks: 40,
  shots: [
    { name: 'battle-wide', kind: '3d', focus: { x: 56, y: 144 }, tilt: 0.55, zoom: 0.62, settleMs: 2500 },
    {
      name: 'battle-close', kind: '3d', focus: { x: 56, y: 144 },
      tilt: 0.85, zoom: 1.6, settleMs: 2500,
      closeup: { cx: 600, cy: 480, w: 620, h: 480 },
    },
  ],
};
