/**
 * 星图视图状态：当前层级（银河/恒星系）、选中对象、筛选。
 */

import { create } from 'zustand';

export type StarmapSelection =
  | { kind: 'system'; id: string }
  | { kind: 'planet'; id: string; systemId: string };

/**
 * 星图直操交互模式（对齐行星页范式）：
 * inspect 默认；attack = 已选舰队，等待在系内点选行星目标下达 fleet_attack。
 */
export type StarmapInteractionMode =
  | { kind: 'inspect' }
  | { kind: 'attack'; fleetId: string };

export const STARMAP_INSPECT_MODE: StarmapInteractionMode = { kind: 'inspect' };

interface StarmapViewState {
  /** 当前聚焦的恒星系；null = 银河总览层。 */
  focusedSystemId: string | null;
  selected: StarmapSelection | null;
  /** 当前直选舰队（点银河层舰队徽标选中）；跨层级保持，离开星图时清空。 */
  selectedFleetId: string | null;
  interactionMode: StarmapInteractionMode;
  discoveredOnly: boolean;
}

interface StarmapViewActions {
  focusSystem: (systemId: string) => void;
  exitToGalaxy: () => void;
  select: (selection: StarmapSelection | null) => void;
  /** 选中/取消舰队；取消时连带退出交互模式。 */
  selectFleet: (fleetId: string | null) => void;
  setInteractionMode: (mode: StarmapInteractionMode) => void;
  /** 退出当前交互模式回到 inspect（Esc/右键）。 */
  exitInteractionMode: () => void;
  setDiscoveredOnly: (value: boolean) => void;
}

export type StarmapViewStore = StarmapViewState & StarmapViewActions;

const initialState: StarmapViewState = {
  focusedSystemId: null,
  selected: null,
  selectedFleetId: null,
  interactionMode: STARMAP_INSPECT_MODE,
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
  selectFleet: (fleetId) => {
    if (fleetId) {
      set({ selectedFleetId: fleetId });
    } else {
      set({ selectedFleetId: null, interactionMode: STARMAP_INSPECT_MODE });
    }
  },
  setInteractionMode: (interactionMode) => {
    set({ interactionMode });
  },
  exitInteractionMode: () => {
    set({ interactionMode: STARMAP_INSPECT_MODE });
  },
  setDiscoveredOnly: (discoveredOnly) => {
    set({ discoveredOnly });
  },
}));

export function resetStarmapViewStore() {
  useStarmapViewStore.setState({ ...initialState });
}
