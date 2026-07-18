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

  const presetParents = useMemo<WarBlueprintDetailView[]>(
    () =>
      (catalog?.public_blueprints ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        source: 'preset',
        state: 'adopted',
        domain: entry.domain,
        base_frame_id: entry.base_frame_id,
        base_hull_id: entry.base_hull_id,
        components: entry.components,
        validation: { valid: true },
      })),
    [catalog?.public_blueprints],
  );

  const parentBlueprint = useMemo(
    () =>
      blueprints.find((item) => item.id === parentBlueprintId)
      ?? presetParents.find((item) => item.id === parentBlueprintId)
      ?? blueprints[0]
      ?? presetParents[0],
    [blueprints, parentBlueprintId, presetParents],
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
      <p className="subtle-text">
        从公开预置蓝图或已有蓝图派生变体，勾选允许后续改动的槽位。
      </p>
      <WarField label="父蓝图">
        <select
          value={parentBlueprint.id}
          onChange={(event) => {
            setParentBlueprintId(event.target.value);
            setAllowedSlots({});
          }}
        >
          {presetParents.length > 0 ? (
            <optgroup label="公开预置蓝图">
              {presetParents.map((blueprint) => (
                <option key={blueprint.id} value={blueprint.id}>
                  {blueprint.name} ({blueprint.id})
                </option>
              ))}
            </optgroup>
          ) : null}
          {blueprints.length > 0 ? (
            <optgroup label="我的蓝图">
              {blueprints.map((blueprint) => (
                <option key={blueprint.id} value={blueprint.id}>
                  {blueprint.name} ({blueprint.id})
                </option>
              ))}
            </optgroup>
          ) : null}
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
