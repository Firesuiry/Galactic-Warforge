/**
 * 星图视图状态：当前层级（银河/恒星系）、选中对象、筛选。
 */

import { create } from 'zustand';

export type StarmapSelection =
  | { kind: 'system'; id: string }
  | { kind: 'planet'; id: string; systemId: string };

interface StarmapViewState {
  /** 当前聚焦的恒星系；null = 银河总览层。 */
  focusedSystemId: string | null;
  selected: StarmapSelection | null;
  discoveredOnly: boolean;
}

interface StarmapViewActions {
  focusSystem: (systemId: string) => void;
  exitToGalaxy: () => void;
  select: (selection: StarmapSelection | null) => void;
  setDiscoveredOnly: (value: boolean) => void;
}

export type StarmapViewStore = StarmapViewState & StarmapViewActions;

const initialState: StarmapViewState = {
  focusedSystemId: null,
  selected: null,
  discoveredOnly: false,
};

export const useStarmapViewStore = create<StarmapViewStore>()((set) => ({
  ...initialState,
  focusSystem: (systemId) => {
    set({ focusedSystemId: systemId, selected: null });
  },
  exitToGalaxy: () => {
    set({ focusedSystemId: null, selected: null });
  },
  select: (selected) => {
    set({ selected });
  },
  setDiscoveredOnly: (discoveredOnly) => {
    set({ discoveredOnly });
  },
}));

export function resetStarmapViewStore() {
  useStarmapViewStore.setState({ ...initialState });
}
