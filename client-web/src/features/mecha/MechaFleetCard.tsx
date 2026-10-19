import type { MechaView } from './model';
import { mechaOperatorLabel, mechaSlotUsage, mechaStatusLabel } from './model';

/**
 * 总览页「机甲」卡片（契约 §7.3 第 4 条）：列出本玩家全部机甲档案。
 *
 * 列：机甲、星球、操作者（等于我时显示「我」并加粗）、状态（存活 / 复活于 tick N）、
 * 背包格数 used/total、施工中/排队。
 */
export function MechaFleetCard({ mechas, playerId, planetNames }: {
  mechas: MechaView[];
  playerId: string;
  /** planet_id → 显示名（缺省显示 planet_id）。 */
  planetNames?: Record<string, string>;
}) {
  return (
    <section className="panel command-mechas" aria-label="机甲">
      <div className="section-title">机甲</div>
      {mechas.length === 0 ? (
        <p className="command-mechas__empty">还没有机甲：在战场分析基站生产执行体机甲。</p>
      ) : (
        <div className="command-mechas__scroll">
          <table className="command-mechas__table">
            <thead>
              <tr>
                <th scope="col">机甲</th>
                <th scope="col">星球</th>
                <th scope="col">操作者</th>
                <th scope="col">状态</th>
                <th scope="col">背包格数</th>
                <th scope="col">施工中/排队</th>
              </tr>
            </thead>
            <tbody>
              {mechas.map((mecha) => {
                const slots = mechaSlotUsage(mecha);
                const mine = mecha.operator === playerId;
                return (
                  <tr className={mine ? 'command-mechas__row--mine' : undefined} key={mecha.unit_id}>
                    <td className="command-mechas__id">{mecha.unit_id}</td>
                    <td>{planetNames?.[mecha.planet_id] ?? mecha.planet_id}</td>
                    <td>
                      {mecha.operator
                        ? <strong className={mine ? 'command-mechas__operator--me' : undefined}>{mechaOperatorLabel(mecha.operator, playerId)}</strong>
                        : <span className="command-mechas__idle">空闲</span>}
                    </td>
                    <td className={mecha.alive ? undefined : 'command-mechas__dead'}>{mechaStatusLabel(mecha)}</td>
                    <td className="command-mechas__num">{slots ? `${slots.used}/${slots.total}` : '—'}</td>
                    <td className="command-mechas__num">{mecha.construction_active}/{mecha.construction_pending}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
