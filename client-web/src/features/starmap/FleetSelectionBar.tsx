/**
 * 舰队情境条：星图直选舰队后的底部悬浮操作条（对齐 PlanetSelectionBar 范式）。
 * 动作只覆盖 server 真实支持的舰队指令：fleet_assign（编队）/ fleet_attack
 * （同星系行星目标，进入 attack 模式点选）/ fleet_disband。指令提交复用
 * war 侧 useWarCommand 管道（回执 + 音效 + 查询失效一致）。
 */

import { useEffect, useState } from 'react';

import type { FleetDetailView, FormationType } from '@shared/types';

import { fleetStateLabel } from '@/features/starmap/model';
import { useStarmapViewStore } from '@/features/starmap/store';
import type { WarCommandHint } from '@/features/war/error-hints';
import type { FeedbackSection, WarCommandInput, WarQueryScope } from '@/features/war/war-query-keys';
import { useApiClient } from '@/hooks/use-api-client';

const FORMATIONS: FormationType[] = ['line', 'vee', 'circle', 'wedge'];

interface FleetSelectionBarProps {
  fleet: FleetDetailView;
  /** 所在星系显示名（已解析，未解析时调用方传 system_id）。 */
  systemName: string;
  scope: WarQueryScope;
  runCommand: (input: WarCommandInput) => void;
  feedbacks: Partial<Record<FeedbackSection, WarCommandHint[]>>;
  isPending: boolean;
}

export function FleetSelectionBar({
  fleet,
  systemName,
  scope,
  runCommand,
  feedbacks,
  isPending,
}: FleetSelectionBarProps) {
  const interactionMode = useStarmapViewStore((state) => state.interactionMode);
  const setInteractionMode = useStarmapViewStore((state) => state.setInteractionMode);
  const exitInteractionMode = useStarmapViewStore((state) => state.exitInteractionMode);
  const selectFleet = useStarmapViewStore((state) => state.selectFleet);
  const client = useApiClient();

  const [formation, setFormation] = useState<FormationType>(fleet.formation);
  useEffect(() => {
    setFormation(fleet.formation);
  }, [fleet.fleet_id, fleet.formation]);

  const attacking = interactionMode.kind === 'attack' && interactionMode.fleetId === fleet.fleet_id;

  function handleAssign() {
    runCommand({
      section: 'reports',
      invalidateKeys: [['war-fleets', scope.serverUrl, scope.playerId]],
      execute: () => client.cmdFleetAssign(fleet.fleet_id, formation),
    });
  }

  function handleAttackToggle() {
    if (attacking) {
      exitInteractionMode();
      return;
    }
    setInteractionMode({ kind: 'attack', fleetId: fleet.fleet_id });
    // fleet_attack 仅支持同星系目标：直接聚焦舰队所在星系，等待点选行星
    const store = useStarmapViewStore.getState();
    if (store.focusedSystemId !== fleet.system_id) {
      store.focusSystem(fleet.system_id);
    }
  }

  function handleDisband() {
    runCommand({
      section: 'reports',
      invalidateKeys: [['war-fleets', scope.serverUrl, scope.playerId]],
      execute: () => client.cmdFleetDisband(fleet.fleet_id),
    });
    selectFleet(null);
  }

  return (
    <div className="starmap-fleet-bar-wrap">
      {feedbacks.reports?.map((feedback, index) => (
        <div className={`status-banner status-banner--${feedback.tone}`} key={`${feedback.title}-${index}`}>
          <strong>{feedback.title}</strong>
          {feedback.detail ? <span>{feedback.detail}</span> : null}
        </div>
      ))}
      <div className="starmap-fleet-bar" data-testid="starmap-fleet-bar">
        <div className="starmap-fleet-bar__info">
          <strong>{fleet.fleet_id}</strong>
          <span className="starmap-fleet-bar__meta">
            {fleetStateLabel(fleet.state)} · 阵型 {fleet.formation}
            · 装甲 {fleet.armor.level}/{fleet.armor.max_level}
            · 结构 {fleet.structure.level}/{fleet.structure.max_level}
            · @{systemName}
          </span>
        </div>
        <div className="starmap-fleet-bar__actions">
          <select
            aria-label="舰队阵型"
            value={formation}
            onChange={(event) => setFormation(event.target.value as FormationType)}
          >
            {FORMATIONS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          <button
            className="secondary-button"
            type="button"
            disabled={isPending || formation === fleet.formation}
            onClick={handleAssign}
          >
            调整编队
          </button>
          <button
            className={`secondary-button${attacking ? ' starmap-fleet-bar__active' : ''}`}
            type="button"
            disabled={isPending}
            onClick={handleAttackToggle}
          >
            {attacking ? '取消攻击' : '攻击目标'}
          </button>
          <button
            className="secondary-button starmap-fleet-bar__danger"
            type="button"
            disabled={isPending}
            onClick={handleDisband}
          >
            解散舰队
          </button>
        </div>
      </div>
    </div>
  );
}
