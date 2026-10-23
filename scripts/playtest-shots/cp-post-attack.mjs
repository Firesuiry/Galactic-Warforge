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
/**
 * 场景准备：cp-post-attack 读档时首攻已结束、敌军实体不保留，所以快进到**下一波**抵达
 * （`/admin/advance` 在 `under_attack` 停下），让画面里有敌军单位。每段 50 tick（步长小，
 * 敌军刚出现就停——150 tick 一段时敌军会在这段里被打光），最多 60 段，超出就按现状拍。
 */
async function advanceUntilEnemy(api) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await api.advance(50).catch((error) => ({ stopped_reason: 'error', detail: String(error) }));
    const scene = await api.get('/world/planets/planet-1-1/scene');
    const units = Object.values(scene.units ?? {});
    const foes = units.filter((unit) => unit.owner_id !== 'p1');
    const own = units.filter((unit) => unit.owner_id === 'p1');
    if (foes.length && own.length) {
      // 机位按**实际位置**算：取离己方最近的那台敌军与它最近的己方单位的中点。
      const nearest = (from, list) => list.reduce((best, unit) => {
        const distance = Math.hypot(unit.position.x - from.position.x, unit.position.y - from.position.y);
        return !best || distance < best.distance ? { unit, distance } : best;
      }, null);
      const foe = own.reduce((best, unit) => {
        const candidate = nearest(unit, foes);
        return !best || candidate.distance < best.distance ? candidate : best;
      }, null).unit;
      const friend = nearest(foe, own).unit;
      // 焦点取「敌军 ↔ 最近的己方单位」中点：宽景看双方关系，近景直接对准敌军。
      // 注意 `focus` 的落点受球面面边界钳制（跨面时会把镜头推离目标），所以近景优先选
      // 同一面内的交战：敌军与友军本来就在同一个面里（都在基地东侧），中点也落在同面。
      const focus = {
        x: (foe.position.x + friend.position.x) / 2,
        y: (foe.position.y + friend.position.y) / 2,
      };
      const shots = SHOTS;
      shots.find((shot) => shot.name === 'battle-wide').focus = focus;
      // 近景直接对准敌军（焦点在中点时会被左侧建筑占满画面）。
      // 近景焦点落在敌军与己方之间的 1/3 处（敌军在上沿、己方在下沿，两边都进画面）。
      shots.find((shot) => shot.name === 'battle-close').focus = {
        x: foe.position.x * 0.66 + friend.position.x * 0.34,
        y: foe.position.y * 0.66 + friend.position.y * 0.34,
      };
      shots.find((shot) => shot.name === 'battle-units').focus = focus;
      return {
        tick: scene.tick,
        stopped_reason: result.stopped_reason,
        foe: `${foe.id}:${foe.type}@${foe.position.x},${foe.position.y}`,
        friend: `${friend.id}:${friend.type}@${friend.position.x},${friend.position.y}`,
        focus,
      };
    }
    if (result.stopped_reason === 'game_over') break;
  }
  return { tick: (await api.health()).tick, foes: [] };
}

/**
 * 机位。`prepare` 会把 focus 改写成实际交战位置（默认值是 cp-post-attack 的已知交战区）。
 * 三个机位都对准「敌军 ↔ 己方」中点，宽景看战场关系，近景看双方单位模型与阵营色。
 */
function sceneShots() {
  return [
    { name: 'battle-wide', kind: '3d', focus: { x: 60, y: 141 }, tilt: 0.55, zoom: 0.8, settleMs: 2500 },
    {
      name: 'battle-close', kind: '3d', focus: { x: 64, y: 141 },
      tilt: 0.55, zoom: 1.5, settleMs: 2500,
      closeup: { cx: 600, cy: 430, w: 620, h: 420 },
    },
    // 双方单位同框（斜俯视，同时看清轮廓与阵营色）。
    { name: 'battle-units', kind: '3d', focus: { x: 60, y: 140 }, tilt: 0.55, zoom: 1.5, settleMs: 2500 },
  ];
}

/** 机位数组必须是**同一个对象**：`prepare` 会就地改 focus，导出后再新建一份的话改动不生效。 */
const SHOTS = sceneShots();

export default {
  title: 'cp-post-attack 首攻后战场',
  checkpoint: 'cp-post-attack',
  settleTicks: 40,
  reload: true,
  prepare: advanceUntilEnemy,
  shots: SHOTS,
};
