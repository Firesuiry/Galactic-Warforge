/**
 * RTS 快捷键体系（C1）：A 攻击移动 / S 停止 / H 坚守 / P 巡逻 / G 守卫，
 * Ctrl+1..9 记录编队、1..9 选取编队。输入框/文本域/下拉框聚焦时不抢按键。
 * 挂在 PlanetPage 一次。
 *
 * Ctrl+Shift+D：调试模式开关（调试面板与左下工具条的「调试」图标默认隐藏，
 * 都由这一个快捷键控制）。放在本 hook 里是因为它已经统一处理输入守卫；
 * 其余修饰键组合（Ctrl+数字、Ctrl/Alt 单按）不受影响。
 */

import { useEffect } from 'react';

import type { PlanetRuntimeView, Unit } from '@shared/types';

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
  /** 跨窗口累积的己方单位：单位掉出相机窗口后编队/指令仍能命中（试玩 1010 E）。 */
  knownOwnUnits?: ReadonlyMap<string, Unit>;
  /** 本玩家名下、绑定给其他发令者的机甲：编队/批量指令先剔除（契约 §3.1）。 */
  foreignMechaIds?: ReadonlySet<string>;
  interactions: PlanetInteractions;
}

export function usePlanetRtsHotkeys({ planet, knownOwnUnits, foreignMechaIds, interactions }: UsePlanetRtsHotkeysInput) {
  const session = useSessionSnapshot();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || !planet) {
        return;
      }
      const store = usePlanetViewStore.getState();
      const playerId = session.playerId;
      const key = event.key;

      // Ctrl+Shift+D：调试模式（面板 + 工具条调试图标一起显示/隐藏）。
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key.toLowerCase() === 'd') {
        store.toggleDebugMode();
        event.preventDefault();
        return;
      }

      // 第 19 轮 §3.5：PageUp/PageDown 升降传送带建造目标高度（先查过：未被其它快捷键占用）。
      // 只在传送带建造模式下生效，且**只在这种模式下 preventDefault**：非传送带模式
      //（勘查/其它建造/其它交互）PageUp/PageDown 必须保留浏览器与页面的默认行为
      //（滚动页面等），不能因为本快捷键把翻页键吞掉（L6 回归断言）。
      // 输入框/下拉框聚焦时上面的守卫已提前返回。
      if (key === 'PageUp' || key === 'PageDown') {
        if (store.interactionMode.kind === 'build' && store.interactionMode.buildingType.startsWith('conveyor_belt')) {
          store.adjustBuildElevation(key === 'PageUp' ? 1 : -1);
          sfx.uiClick();
          event.preventDefault();
        }
        return;
      }

      // Ctrl+数字：记录编队（当前多选集合，含阵亡过滤前的原始 id 由 prune 兜底）
      if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(key)) {
        const index = Number(key);
        if (index <= CONTROL_GROUP_COUNT) {
          const ids = commandableUnitIds(planet, store.selectedUnits, playerId, knownOwnUnits, foreignMechaIds);
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

      const selection = commandableUnitIds(planet, store.selectedUnits, playerId, knownOwnUnits, foreignMechaIds);
      if (selection.length === 0) {
        return;
      }
      switch (key.toLowerCase()) {
        case 'a':
          if (orderEligibleUnitIds(planet, store.selectedUnits, playerId, knownOwnUnits, foreignMechaIds).length > 0) {
            store.setInteractionMode({ kind: 'unit_order', order: 'attack_move' });
            sfx.uiClick();
          }
          break;
        case 'p':
          if (orderEligibleUnitIds(planet, store.selectedUnits, playerId, knownOwnUnits, foreignMechaIds).length > 0) {
            store.setInteractionMode({ kind: 'unit_order', order: 'patrol' });
            sfx.uiClick();
          }
          break;
        case 'g':
          if (orderEligibleUnitIds(planet, store.selectedUnits, playerId, knownOwnUnits, foreignMechaIds).length > 0) {
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
  }, [foreignMechaIds, interactions, knownOwnUnits, planet, session.playerId]);
}
