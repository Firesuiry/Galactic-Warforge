/**
 * 单位卡片（C4）：蓝图/世界单位/单位/小队的统一展示卡。
 * 纯展示组件——数据映射全部在 unit-card-model.ts（单一出处），这里只渲染。
 */

import {
  UNIT_CARD_RUNTIME_CLASS_LABELS,
  unitCardArmorLabel,
  unitCardDomainLabel,
  unitCardWeaponLabel,
  type UnitCardModel,
} from '@/features/war/unit-card-model';

interface UnitCardProps {
  card: UnitCardModel;
  /** 紧凑模式（选择条等窄位）：隐藏克制说明与出处注记。 */
  compact?: boolean;
}

export function UnitCard({ card, compact = false }: UnitCardProps) {
  return (
    <article className="unit-card" data-testid="unit-card">
      <header className="unit-card__head">
        <strong className="unit-card__title">{card.title}</strong>
        <span className="war-chip">{unitCardDomainLabel(card.domain)}</span>
        {card.runtimeClass ? (
          <span className="war-chip">
            {UNIT_CARD_RUNTIME_CLASS_LABELS[card.runtimeClass] ?? card.runtimeClass}
          </span>
        ) : null}
      </header>
      {card.subtitle ? <p className="unit-card__subtitle">{card.subtitle}</p> : null}

      {card.stats.length > 0 ? (
        <dl className="unit-card__stats">
          {card.stats.map((entry) => (
            <div key={entry.key}>
              <dt>{entry.label}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="subtle-text unit-card__stats-pending">战斗数值未知</p>
      )}

      <dl className="unit-card__stats unit-card__stats--classes">
        <div>
          <dt>武器类别</dt>
          <dd>{unitCardWeaponLabel(card.weaponClass)}</dd>
        </div>
        <div>
          <dt>护甲类别</dt>
          <dd>{unitCardArmorLabel(card.armorClass)}</dd>
        </div>
      </dl>

      {card.techGate ? (
        <p
          className={
            card.techGate.unlocked
              ? 'unit-card__tech unit-card__tech--ok'
              : 'unit-card__tech unit-card__tech--locked'
          }
        >
          {card.techGate.unlocked
            ? `科技已解锁：${card.techGate.techName}`
            : `需要科技：${card.techGate.techName}（${card.techGate.techId}）`}
        </p>
      ) : null}

      {compact ? null : (
        <p className="subtle-text unit-card__counters">{card.countersText}</p>
      )}
    </article>
  );
}
