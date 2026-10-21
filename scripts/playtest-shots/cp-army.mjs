// cp-army 模型素材机位：同一存档点、同一机位，`--procedural` 拍程序化模型，默认拍现成 GLB。
//
// 覆盖本次换素材的建筑与单位（cp-army 场景里真实存在的）：
//   assembling_machine_mk1 (62,151) / (59,144)、barracks (53,139)、supply_station (41,142)、
//   battlefield_analysis_base (54,144) 旁的基地群，以及士兵队列 (50..56,135..139)。
//
// 用法（先起环境）：
//   bash scripts/playtest-up.sh 213 --tick-rate 4
//   node scripts/playtest-shots/run.mjs 213 cp-army /tmp/models-before --procedural
//   node scripts/playtest-shots/run.mjs 213 cp-army /tmp/models-after
export default {
  title: 'cp-army 现成模型 / 程序化模型同机位对照',
  checkpoint: 'cp-army',
  settleTicks: 50,
  shots: [
    // 整片厂区：装配台、兵营、补给站、基地同框。
    { name: 'industry-overview', kind: '3d', focus: { x: 56, y: 144 }, tilt: 0.55, zoom: 0.62, settleMs: 2500 },
    // 装配台特写（3×3）。
    {
      name: 'assembling-machine', kind: '3d', focus: { x: 63, y: 150 }, tilt: 0.85, zoom: 1.7, settleMs: 2200,
      closeup: { cx: 600, cy: 500, w: 560, h: 440 },
    },
    // 兵营 + 士兵队列（3×3 建筑 + 10 个士兵）。
    {
      name: 'barracks-squad', kind: '3d', focus: { x: 53, y: 138 }, tilt: 0.85, zoom: 1.6, settleMs: 2200,
      closeup: { cx: 600, cy: 500, w: 620, h: 480 },
    },
    // 补给站（3×3）。
    {
      name: 'supply-station', kind: '3d', focus: { x: 48, y: 143 }, tilt: 0.85, zoom: 1.7, settleMs: 2200,
      closeup: { cx: 600, cy: 500, w: 520, h: 420 },
    },
  ],
};
