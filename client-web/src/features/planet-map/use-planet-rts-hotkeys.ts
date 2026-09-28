/**
 * RTS 快捷键体系（C1）：A 攻击移动 / S 停止 / H 坚守 / P 巡逻 / G 守卫，
 * Ctrl+1..9 记录编队、1..9 选取编队。输入框/文本域/下拉框聚焦时不抢按键
 * （沿用 PlanetMapPixi 的输入守卫模式）。2D/3D 共用：挂在 PlanetPage 一次。
 */

import { useEffect } from 'react';

import type { PlanetRuntimeView } from '@shared/types';

import { sfx } from '@/engine/audio';
import type { PlanetRenderView } from '@/features/planet-map/model';
import {
  commandableUnitIds,
  orderEligibleUnitIds,
  pruneControlGroup,
} from '@/features/planet-map/rts-commands';
import { CONTROL_GROUP_COUNT, usePlanetViewStore } from '@/features/planet-map/store';
import type { PlanetInteractions } from '@/features/planet-map/use-planet-interactions';
import { useSessionSnapshot } from '@/hooks/use-session';

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element
    && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable),
  );
}

interface UsePlanetRtsHotkeysInput {
  planet?: PlanetRenderView;
  runtime?: PlanetRuntimeView;
  interactions: PlanetInteractions;
}

export function usePlanetRtsHotkeys({ planet, interactions }: UsePlanetRtsHotkeysInput) {
  const session = useSessionSnapshot();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || !planet) {
        return;
      }
      const store = usePlanetViewStore.getState();
      const playerId = session.playerId;
      const key = event.key;

      // Ctrl+数字：记录编队（当前多选集合，含阵亡过滤前的原始 id 由 prune 兜底）
      if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(key)) {
        const index = Number(key);
        if (index <= CONTROL_GROUP_COUNT) {
          const ids = commandableUnitIds(planet, store.selectedUnits, playerId);
          store.setControlGroup(index, ids);
          if (ids.length > 0) {
            sfx.uiClick();
          }
          event.preventDefault();
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      // 数字：选取编队（过滤已阵亡成员；空编队不清当前选择）
      if (/^[1-9]$/.test(key)) {
        const group = store.controlGroups[Number(key)];
        if (group && group.length > 0) {
          const ids = pruneControlGroup(planet, playerId, group);
          if (ids.length > 0) {
            store.setSelectedUnits(ids);
            const first = planet.units?.[ids[0]];
            store.setSelected(first
              ? { kind: 'unit', id: first.id, position: first.position }
              : null);
            sfx.uiClick();
          }
        }
        return;
      }

      const selection = commandableUnitIds(planet, store.selectedUnits, playerId);
      if (selection.length === 0) {
        return;
      }
      switch (key.toLowerCase()) {
        case 'a':
          if (orderEligibleUnitIds(planet, store.selectedUnits, playerId).length > 0) {
            store.setInteractionMode({ kind: 'unit_order', order: 'attack_move' });
            sfx.uiClick();
          }
          break;
        case 'p':
          if (orderEligibleUnitIds(planet, store.selectedUnits, playerId).length > 0) {
            store.setInteractionMode({ kind: 'unit_order', order: 'patrol' });
            sfx.uiClick();
          }
          break;
        case 'g':
          if (orderEligibleUnitIds(planet, store.selectedUnits, playerId).length > 0) {
            store.setInteractionMode({ kind: 'unit_order', order: 'guard' });
            sfx.uiClick();
          }
          break;
        case 's':
          interactions.orderNow('stop');
          break;
        case 'h':
          interactions.orderNow('hold');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [interactions, planet, session.playerId]);
}
