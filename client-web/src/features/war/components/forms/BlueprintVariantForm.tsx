import { useMemo, useState } from 'react';

import type { WarBlueprintDetailView, WarfareCatalogView } from '@shared/types';

import { WarField } from '@/features/war/components/WarField';
import { getBlueprintSlotComponents } from '@/features/war/format';
import type { WarCommandInput } from '@/features/war/war-query-keys';
import type { WarQueryScope } from '@/features/war/war-query-keys';
import { useApiClient } from '@/hooks/use-api-client';

interface BlueprintVariantFormProps {
  scope: WarQueryScope;
  runCommand: (input: WarCommandInput) => void;
  isPending: boolean;
  catalog: WarfareCatalogView | undefined;
  blueprints: WarBlueprintDetailView[];
}

/**
 * blueprint_variant：从父蓝图派生变体，锁死允许改动的槽位集合。
 * 替代玩家过去必须切 CLI 才能下达的「蓝图改型」操作。
 */
export function BlueprintVariantForm({
  scope,
  runCommand,
  isPending,
  catalog,
  blueprints,
}: BlueprintVariantFormProps) {
  const client = useApiClient();
  const [parentBlueprintId, setParentBlueprintId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [variantName, setVariantName] = useState('');
  const [allowedSlots, setAllowedSlots] = useState<Record<string, boolean>>({});

  const parentBlueprint = useMemo(
    () => blueprints.find((item) => item.id === parentBlueprintId) ?? blueprints[0],
    [blueprints, parentBlueprintId],
  );
  const slots = useMemo(
    () => getBlueprintSlotComponents(catalog, parentBlueprint),
    [catalog, parentBlueprint],
  );

  function toggleSlot(slotId: string) {
    setAllowedSlots((current) => ({ ...current, [slotId]: !current[slotId] }));
  }

  function handleSubmit() {
    if (!parentBlueprint?.id) {
      return;
    }
    const trimmedId = variantId.trim();
    if (!trimmedId) {
      return;
    }
    const slotIds = slots
      .map((entry) => entry.slot.id)
      .filter((slotId) => allowedSlots[slotId]);
    runCommand({
      section: 'blueprint',
      invalidateKeys: [['war-blueprints', scope.serverUrl, scope.playerId]],
      execute: () => client.cmdBlueprintVariant(
        parentBlueprint.id,
        trimmedId,
        slotIds,
        { name: variantName.trim() || undefined },
      ),
    });
    setVariantId('');
    setVariantName('');
    setAllowedSlots({});
  }

  if (!parentBlueprint) {
    return null;
  }

  return (
    <article className="war-card">
      <h3>蓝图改型</h3>
      <WarField label="父蓝图">
        <select
          value={parentBlueprint.id}
          onChange={(event) => {
            setParentBlueprintId(event.target.value);
            setAllowedSlots({});
          }}
        >
          {blueprints.map((blueprint) => (
            <option key={blueprint.id} value={blueprint.id}>
              {blueprint.name} ({blueprint.id})
            </option>
          ))}
        </select>
      </WarField>
      <WarField label="变体 ID">
        <input
          value={variantId}
          onChange={(event) => setVariantId(event.target.value)}
          placeholder="例如 corvette_scout"
        />
      </WarField>
      <WarField label="变体名称">
        <input
          value={variantName}
          onChange={(event) => setVariantName(event.target.value)}
          placeholder="可选"
        />
      </WarField>
      <div className="war-field">
        <span>允许改动的槽位</span>
        <ul className="war-list">
          {slots.map(({ slot }) => (
            <li key={slot.id}>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(allowedSlots[slot.id])}
                  onChange={() => toggleSlot(slot.id)}
                />
                {' '}
                {slot.id}（{slot.category}）
              </label>
            </li>
          ))}
        </ul>
      </div>
      <button
        className="secondary-button war-button"
        type="button"
        disabled={isPending || !variantId.trim()}
        onClick={handleSubmit}
      >
        派生变体
      </button>
    </article>
  );
}
