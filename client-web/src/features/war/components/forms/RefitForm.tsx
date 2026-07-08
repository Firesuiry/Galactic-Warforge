import { useMemo, useState } from 'react';

import type { Building, FleetDetailView, WarBlueprintDetailView } from '@shared/types';

import { WarField } from '@/features/war/components/WarField';
import type { WarCommandInput, WarQueryScope } from '@/features/war/war-query-keys';
import { useApiClient } from '@/hooks/use-api-client';

interface RefitFormProps {
  scope: WarQueryScope;
  runCommand: (input: WarCommandInput) => void;
  isPending: boolean;
  buildings: Building[];
  fleets: FleetDetailView[];
  blueprints: WarBlueprintDetailView[];
}

/**
 * refit_unit：把某个单位（舰队）翻修改装到目标蓝图。
 * 替代玩家过去只能看翻修单、不能下达的「改装翻修」。
 */
export function RefitForm({
  scope,
  runCommand,
  isPending,
  buildings,
  fleets,
  blueprints,
}: RefitFormProps) {
  const client = useApiClient();
  const [buildingId, setBuildingId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [targetBlueprintId, setTargetBlueprintId] = useState('');

  const building = useMemo(
    () => buildings.find((item) => item.id === buildingId) ?? buildings[0],
    [buildings, buildingId],
  );
  const unit = useMemo(
    () => fleets.find((item) => item.fleet_id === unitId) ?? fleets[0],
    [fleets, unitId],
  );
  const targetBlueprint = useMemo(
    () => blueprints.find((item) => item.id === targetBlueprintId) ?? blueprints[0],
    [blueprints, targetBlueprintId],
  );

  function handleSubmit() {
    if (!building?.id || !unit?.fleet_id || !targetBlueprint?.id) {
      return;
    }
    runCommand({
      section: 'industry',
      invalidateKeys: [['war-industry', scope.serverUrl, scope.playerId]],
      execute: () => client.cmdRefitUnit(
        building.id,
        unit.fleet_id,
        targetBlueprint.id,
      ),
    });
  }

  if (!building || !unit || !targetBlueprint) {
    return null;
  }

  return (
    <article className="war-card">
      <h3>翻修改装</h3>
      <WarField label="改装船坞">
        <select value={building.id} onChange={(event) => setBuildingId(event.target.value)}>
          {buildings.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.type} ({entry.id})
            </option>
          ))}
        </select>
      </WarField>
      <WarField label="改装单位">
        <select value={unit.fleet_id} onChange={(event) => setUnitId(event.target.value)}>
          {fleets.map((entry) => (
            <option key={entry.fleet_id} value={entry.fleet_id}>
              {entry.fleet_id}（{entry.system_id ?? '未知星系'}）
            </option>
          ))}
        </select>
      </WarField>
      <WarField label="目标蓝图">
        <select value={targetBlueprint.id} onChange={(event) => setTargetBlueprintId(event.target.value)}>
          {blueprints.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} ({entry.id})
            </option>
          ))}
        </select>
      </WarField>
      <button
        className="secondary-button war-button"
        type="button"
        disabled={isPending}
        onClick={handleSubmit}
      >
        下达翻修
      </button>
    </article>
  );
}
