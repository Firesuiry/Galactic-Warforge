import { useMemo, useState } from 'react';

import type { Building, WarBlueprintDetailView, WarDeploymentHubView } from '@shared/types';

import { WarField } from '@/features/war/components/WarField';
import type { WarCommandInput, WarQueryScope } from '@/features/war/war-query-keys';
import { useApiClient } from '@/hooks/use-api-client';

interface ProductionQueueFormProps {
  scope: WarQueryScope;
  runCommand: (input: WarCommandInput) => void;
  isPending: boolean;
  buildings: Building[];
  deploymentHubs: WarDeploymentHubView[];
  blueprints: WarBlueprintDetailView[];
}

/**
 * queue_military_production：在工厂排队量产某蓝图，产物进入指定部署枢纽。
 * 替代玩家过去只能看、不能下达的「军工量产排队」。
 */
export function ProductionQueueForm({
  scope,
  runCommand,
  isPending,
  buildings,
  deploymentHubs,
  blueprints,
}: ProductionQueueFormProps) {
  const client = useApiClient();
  const [factoryId, setFactoryId] = useState('');
  const [hubId, setHubId] = useState('');
  const [blueprintId, setBlueprintId] = useState('');
  const [count, setCount] = useState(1);

  const factory = useMemo(
    () => buildings.find((item) => item.id === factoryId) ?? buildings[0],
    [buildings, factoryId],
  );
  const hub = useMemo(
    () => deploymentHubs.find((item) => item.building_id === hubId) ?? deploymentHubs[0],
    [deploymentHubs, hubId],
  );
  const blueprint = useMemo(
    () => blueprints.find((item) => item.id === blueprintId) ?? blueprints[0],
    [blueprints, blueprintId],
  );

  function handleSubmit() {
    if (!factory?.id || !hub?.building_id || !blueprint?.id) {
      return;
    }
    runCommand({
      section: 'industry',
      invalidateKeys: [
        ['war-industry', scope.serverUrl, scope.playerId],
        ['war-fleets', scope.serverUrl, scope.playerId],
      ],
      execute: () => client.cmdQueueMilitaryProduction(
        factory.id,
        hub.building_id,
        blueprint.id,
        { count: Math.max(1, Number(count) || 1) },
      ),
    });
  }

  if (!factory || !hub || !blueprint) {
    return null;
  }

  return (
    <article className="war-card">
      <h3>量产排队</h3>
      <WarField label="量产工厂">
        <select value={factory.id} onChange={(event) => setFactoryId(event.target.value)}>
          {buildings.map((building) => (
            <option key={building.id} value={building.id}>
              {building.type} ({building.id})
            </option>
          ))}
        </select>
      </WarField>
      <WarField label="量产部署枢纽">
        <select value={hub.building_id} onChange={(event) => setHubId(event.target.value)}>
          {deploymentHubs.map((entry) => (
            <option key={entry.building_id} value={entry.building_id}>
              {entry.building_type} ({entry.building_id})
            </option>
          ))}
        </select>
      </WarField>
      <WarField label="量产蓝图">
        <select value={blueprint.id} onChange={(event) => setBlueprintId(event.target.value)}>
          {blueprints.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} ({entry.id})
            </option>
          ))}
        </select>
      </WarField>
      <WarField label="数量">
        <input
          type="number"
          min={1}
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
        />
      </WarField>
      <button
        className="secondary-button war-button"
        type="button"
        disabled={isPending}
        onClick={handleSubmit}
      >
        下达量产
      </button>
    </article>
  );
}
