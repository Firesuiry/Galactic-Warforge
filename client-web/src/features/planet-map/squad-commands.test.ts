import { describe, expect, it } from 'vitest';

import type { CombatSquad, WarTaskForceView } from '@shared/types';

import {
  findSquadTaskForceId,
  ownCombatSquads,
  resolveSquadDeploy,
  theaterZoneFromDragRect,
  theaterZoneColor,
  theaterZoneTypeLabel,
} from '@/features/planet-map/squad-commands';

function taskForce(id: string, squadIds: string[]): WarTaskForceView {
  return {
    id,
    stance: 'hold',
    members: squadIds.map((entityId) => ({
      kind: 'squad' as const,
      entity_id: entityId,
    })),
    command_capacity: { total: 10, used: 1 },
    supply_status: { current: {}, capacity: {}, condition: 'healthy' },
  };
}

describe('squad-commands', () => {
  it('findSquadTaskForceId 命中小队所属任务群', () => {
    const forces = [taskForce('tf-1', ['sq-a', 'sq-b']), taskForce('tf-2', ['sq-c'])];
    expect(findSquadTaskForceId(forces, 'sq-b')).toBe('tf-1');
    expect(findSquadTaskForceId(forces, 'sq-c')).toBe('tf-2');
    expect(findSquadTaskForceId(forces, 'sq-x')).toBeUndefined();
  });

  it('resolveSquadDeploy 按任务群分组，未编组小队单独列出', () => {
    const forces = [taskForce('tf-1', ['sq-a', 'sq-b'])];
    const result = resolveSquadDeploy(forces, ['sq-a', 'sq-b', 'sq-free']);
    expect(result.plans).toEqual([
      { taskForceId: 'tf-1', squadIds: ['sq-a', 'sq-b'] },
    ]);
    expect(result.unassignedSquadIds).toEqual(['sq-free']);
  });

  it('resolveSquadDeploy 空选择', () => {
    expect(resolveSquadDeploy([], [])).toEqual({ plans: [], unassignedSquadIds: [] });
  });

  it('ownCombatSquads 过滤非己方与已摧毁', () => {
    const squads = [
      { id: 'sq-1', owner_id: 'p1', state: 'idle' },
      { id: 'sq-2', owner_id: 'p2', state: 'idle' },
      { id: 'sq-3', owner_id: 'p1', state: 'destroyed' },
    ] as CombatSquad[];
    expect(ownCombatSquads(squads, 'p1').map((squad) => squad.id)).toEqual(['sq-1']);
    expect(ownCombatSquads(undefined, 'p1')).toEqual([]);
  });

  it('theaterZoneFromDragRect 矩形 → 圆心+半径', () => {
    const zone = theaterZoneFromDragRect({ x: 10, y: 10 }, { x: 30, y: 22 });
    expect(zone.position).toEqual({ x: 20, y: 16, z: 0 });
    expect(zone.radius).toBe(10);
  });

  it('theaterZoneFromDragRect 反向拖拽与最小半径', () => {
    const zone = theaterZoneFromDragRect({ x: 30, y: 22 }, { x: 10, y: 10 });
    expect(zone.position).toEqual({ x: 20, y: 16, z: 0 });
    expect(zone.radius).toBe(10);

    const tiny = theaterZoneFromDragRect({ x: 5, y: 5 }, { x: 5.4, y: 5.4 });
    expect(tiny.radius).toBe(2);
  });

  it('战区类型配色与中文名', () => {
    expect(theaterZoneColor('no_entry')).toBe('#ffb454');
    expect(theaterZoneColor('primary')).toBe('#39e6d0');
    expect(theaterZoneTypeLabel('rally')).toBe('集结点');
  });
});
