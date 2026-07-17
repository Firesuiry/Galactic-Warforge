import { beforeEach, describe, expect, it } from 'vitest';

import { resetStarmapViewStore, useStarmapViewStore } from '@/features/starmap/store';

describe('starmap/store', () => {
  beforeEach(() => {
    resetStarmapViewStore();
  });

  it('focusSystem 进入恒星系并清空选中', () => {
    useStarmapViewStore.getState().select({ kind: 'system', id: 'sys-1' });
    useStarmapViewStore.getState().focusSystem('sys-1');
    const state = useStarmapViewStore.getState();
    expect(state.focusedSystemId).toBe('sys-1');
    expect(state.selected).toBeNull();
  });

  it('exitToGalaxy 返回银河并清空选中', () => {
    useStarmapViewStore.getState().focusSystem('sys-1');
    useStarmapViewStore.getState().select({ kind: 'planet', id: 'p-1', systemId: 'sys-1' });
    useStarmapViewStore.getState().exitToGalaxy();
    const state = useStarmapViewStore.getState();
    expect(state.focusedSystemId).toBeNull();
    expect(state.selected).toBeNull();
  });

  it('select / setDiscoveredOnly', () => {
    useStarmapViewStore.getState().select({ kind: 'system', id: 'sys-2' });
    expect(useStarmapViewStore.getState().selected).toEqual({ kind: 'system', id: 'sys-2' });
    useStarmapViewStore.getState().setDiscoveredOnly(true);
    expect(useStarmapViewStore.getState().discoveredOnly).toBe(true);
  });
});
