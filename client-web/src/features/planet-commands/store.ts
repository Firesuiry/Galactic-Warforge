import { create } from "zustand";

import type { Position, GameEventDetail } from "@shared/types";

export type CommandJournalStatus = "pending" | "succeeded" | "failed";

export interface CommandJournalFocus {
  entityId?: string;
  position?: Position;
  techId?: string;
  planetId?: string;
  systemId?: string;
  itemId?: string;
}

export interface PlanetCommandJournalEntry {
  requestId: string;
  commandType: string;
  planetId: string;
  submittedAt: number;
  enqueueTick?: number;
  status: CommandJournalStatus;
  acceptedMessage: string;
  authoritativeCode?: string;
  authoritativeMessage?: string;
  relatedEventIds: string[];
  focus?: CommandJournalFocus;
  nextHint?: string;
}

export type PlanetActivityMode =
  | "key_feedback"
  | "all"
  | "command_only"
  | "alerts_only";

interface PlanetCommandState {
  planetId: string;
  activityMode: PlanetActivityMode;
  journal: PlanetCommandJournalEntry[];
}

interface PlanetCommandActions {
  resetForPlanet: (planetId: string) => void;
  setActivityMode: (mode: PlanetActivityMode) => void;
  addJournalEntry: (
    entry: Omit<PlanetCommandJournalEntry, "submittedAt" | "relatedEventIds"> & {
      submittedAt?: number;
      relatedEventIds?: string[];
    },
  ) => void;
  ingestEvent: (event: GameEventDetail) => void;
}

function createInitialState(planetId = ""): PlanetCommandState {
  return {
    planetId,
    activityMode: "key_feedback",
    journal: [],
  };
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveAuthoritativeStatus(payload: Record<string, unknown>): CommandJournalStatus {
  const code = asString(payload.code).toUpperCase();
  const status = asString(payload.status).toLowerCase();

  if (code && code !== "OK") {
    return "failed";
  }
  if (status.includes("fail") || status.includes("error")) {
    return "failed";
  }
  return "succeeded";
}

function resolvePosition(payload: Record<string, unknown>) {
  const position = asRecord(payload.position);
  if (position) {
    const x = asNumber(position.x);
    const y = asNumber(position.y);
    if (x !== undefined && y !== undefined) {
      return {
        x,
        y,
        z: asNumber(position.z) ?? 0,
      } satisfies Position;
    }
  }

  const x = asNumber(payload.x);
  const y = asNumber(payload.y);
  if (x !== undefined && y !== undefined) {
    return {
      x,
      y,
      z: asNumber(payload.z) ?? 0,
    } satisfies Position;
  }
  return undefined;
}

function matchesFocus(
  focus: CommandJournalFocus | undefined,
  event: GameEventDetail,
) {
  if (!focus) {
    return false;
  }

  const payload = asRecord(event.payload) ?? {};
  if (
    focus.entityId
    && [payload.entity_id, payload.building_id, payload.target_id].some(
      (value) => asString(value) === focus.entityId,
    )
  ) {
    return true;
  }

  if (focus.techId && asString(payload.tech_id) === focus.techId) {
    return true;
  }

  const position = resolvePosition(payload);
  if (
    focus.position
    && position
    && Math.round(position.x) === Math.round(focus.position.x)
    && Math.round(position.y) === Math.round(focus.position.y)
  ) {
    return true;
  }

  return false;
}

function resolveNextHint(entry: PlanetCommandJournalEntry) {
  const message = `${entry.authoritativeCode ?? ""} ${entry.authoritativeMessage ?? ""}`.toLowerCase();

  if (entry.commandType === "start_research") {
    if (message.includes("matrix") || message.includes("waiting_matrix")) {
      return "先把 electromagnetic_matrix 装入研究站，再继续启动研究。";
    }
    if (message.includes("lab") || message.includes("waiting_lab")) {
      return "先选中一台空配方研究站，再继续研究。";
    }
  }

  if (
    entry.commandType === "transfer_item"
    && entry.focus?.techId
    && entry.status === "succeeded"
  ) {
    return `物料已装入，下一步可继续启动 ${entry.focus.techId}。`;
  }

  if (
    entry.commandType === "switch_active_planet"
    && entry.status === "succeeded"
  ) {
    return "active planet 已切换，现在可以继续在该星球执行建造、装料和戴森命令。";
  }

  if (
    ["build_dyson_node", "build_dyson_frame", "build_dyson_shell"].includes(
      entry.commandType,
    )
    && entry.status === "succeeded"
  ) {
    return "脚手架已提交，下一步可以继续发射太阳帆或火箭。";
  }

  if (
    ["launch_solar_sail", "launch_rocket", "set_ray_receiver_mode"].includes(
      entry.commandType,
    )
    && entry.status === "succeeded"
  ) {
    return "留意活动流中的 rocket_launched、research_completed 或电力变化事件。";
  }

  return undefined;
}

function upsertRelatedEvent(
  entry: PlanetCommandJournalEntry,
  event: GameEventDetail,
) {
  if (entry.relatedEventIds.includes(event.event_id)) {
    return entry;
  }
  return {
    ...entry,
    relatedEventIds: [event.event_id, ...entry.relatedEventIds].slice(0, 8),
  };
}

export const usePlanetCommandStore = create<
  PlanetCommandState & PlanetCommandActions
>()((set) => ({
  ...createInitialState(),
  resetForPlanet: (planetId) => {
    set(createInitialState(planetId));
  },
  setActivityMode: (activityMode) => {
    set({ activityMode });
  },
  addJournalEntry: (entry) => {
    set((state) => {
      const nextEntry: PlanetCommandJournalEntry = {
        submittedAt: entry.submittedAt ?? Date.now(),
        relatedEventIds: entry.relatedEventIds ?? [],
        ...entry,
      };
      const remaining = state.journal.filter(
        (candidate) => candidate.requestId !== nextEntry.requestId,
      );
      return {
        journal: [nextEntry, ...remaining].slice(0, 40),
      };
    });
  },
  ingestEvent: (event) => {
    set((state) => {
      if (state.journal.length === 0) {
        return state;
      }

      const payload = asRecord(event.payload) ?? {};
      if (event.event_type === "command_result") {
        const requestId = asString(payload.request_id);
        if (!requestId) {
          return state;
        }

        let didUpdate = false;
        const nextJournal = state.journal.map((entry) => {
          if (entry.requestId !== requestId) {
            return entry;
          }
          didUpdate = true;
          const nextEntry = {
            ...upsertRelatedEvent(entry, event),
            status: resolveAuthoritativeStatus(payload),
            authoritativeCode: asString(payload.code) || entry.authoritativeCode,
            authoritativeMessage:
              asString(payload.message) || entry.authoritativeMessage,
          };
          return {
            ...nextEntry,
            nextHint: resolveNextHint(nextEntry),
          };
        });

        if (!didUpdate) {
          return state;
        }
        return {
          journal: nextJournal,
        };
      }

      let changed = false;
      const nextJournal = state.journal.map((entry) => {
        if (!matchesFocus(entry.focus, event)) {
          return entry;
        }
        changed = true;
        return upsertRelatedEvent(entry, event);
      });

      if (!changed) {
        return state;
      }
      return {
        journal: nextJournal,
      };
    });
  },
}));

export function getLatestCommandEntry(entries: PlanetCommandJournalEntry[]) {
  return entries[0];
}

export function getPendingCommandCount(entries: PlanetCommandJournalEntry[]) {
  return entries.filter((entry) => entry.status === "pending").length;
}
