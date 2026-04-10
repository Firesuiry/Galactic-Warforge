import { create } from "zustand";

import type {
  CommandResponse,
  EventSnapshotResponse,
  GameEventDetail,
  Position,
} from "@shared/types";

export type CommandJournalStatus = "pending" | "succeeded" | "failed";
export type CommandAuthoritativeSource = "response" | "event" | "snapshot";

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
  authoritativeSource?: CommandAuthoritativeSource;
  relatedEventIds: string[];
  focus?: CommandJournalFocus;
  nextHint?: string;
  pendingRecovery?: boolean;
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
  reconcileAcceptedResponse: (input: {
    commandType: string;
    planetId: string;
    response: CommandResponse;
    focus?: CommandJournalFocus;
    submittedAt?: number;
  }) => void;
  reconcileAuthoritativeEvent: (event: GameEventDetail) => void;
  hydrateAuthoritativeSnapshot: (snapshot: EventSnapshotResponse) => void;
  markPendingRecovery: (requestId: string) => void;
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

function buildAcceptedMessage(commandType: string, response: CommandResponse) {
  return response.results.map((result) => result.message).join(" / ")
    || `${commandType} accepted`;
}

function mapJournalEntries(
  entries: PlanetCommandJournalEntry[],
  requestId: string,
  updater: (entry: PlanetCommandJournalEntry) => PlanetCommandJournalEntry,
) {
  let changed = false;
  const nextEntries = entries.map((entry) => {
    if (entry.requestId !== requestId) {
      return entry;
    }
    changed = true;
    return updater(entry);
  });
  return { changed, nextEntries };
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

function reconcileCommandResultEntry(
  entry: PlanetCommandJournalEntry,
  event: GameEventDetail,
  source: Exclude<CommandAuthoritativeSource, "response">,
) {
  const payload = asRecord(event.payload) ?? {};
  const nextEntry = {
    ...upsertRelatedEvent(entry, event),
    status: resolveAuthoritativeStatus(payload),
    authoritativeCode: asString(payload.code) || entry.authoritativeCode,
    authoritativeMessage:
      asString(payload.message) || entry.authoritativeMessage,
    authoritativeSource: source,
    pendingRecovery: false,
  };
  return {
    ...nextEntry,
    nextHint: resolveNextHint(nextEntry),
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
  reconcileAcceptedResponse: (input) => {
    set((state) => {
      const acceptedMessage = buildAcceptedMessage(
        input.commandType,
        input.response,
      );
      const nextEntry: PlanetCommandJournalEntry = {
        requestId: input.response.request_id,
        commandType: input.commandType,
        planetId: input.planetId,
        submittedAt: input.submittedAt ?? Date.now(),
        enqueueTick: input.response.enqueue_tick,
        status: input.response.accepted ? "pending" : "failed",
        acceptedMessage,
        authoritativeCode: input.response.accepted
          ? undefined
          : input.response.results[0]?.code,
        authoritativeMessage: input.response.accepted
          ? undefined
          : acceptedMessage,
        authoritativeSource: input.response.accepted ? undefined : "response",
        relatedEventIds: [],
        focus: input.focus,
        pendingRecovery: false,
      };

      return {
        journal: [
          {
            ...nextEntry,
            nextHint: resolveNextHint(nextEntry),
          },
          ...state.journal.filter(
            (entry) => entry.requestId !== input.response.request_id,
          ),
        ].slice(0, 40),
      };
    });
  },
  reconcileAuthoritativeEvent: (event) => {
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

        const { changed, nextEntries } = mapJournalEntries(
          state.journal,
          requestId,
          (entry) => reconcileCommandResultEntry(entry, event, "event"),
        );
        if (!changed) {
          return state;
        }
        return {
          journal: nextEntries,
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
  hydrateAuthoritativeSnapshot: (snapshot) => {
    set((state) => {
      if (state.journal.length === 0 || snapshot.events.length === 0) {
        return state;
      }

      let nextJournal = state.journal;
      let changed = false;
      for (const event of snapshot.events) {
        if (event.event_type !== "command_result") {
          continue;
        }
        const payload = asRecord(event.payload) ?? {};
        const requestId = asString(payload.request_id);
        if (!requestId) {
          continue;
        }
        const result = mapJournalEntries(
          nextJournal,
          requestId,
          (entry) => reconcileCommandResultEntry(entry, event, "snapshot"),
        );
        if (!result.changed) {
          continue;
        }
        changed = true;
        nextJournal = result.nextEntries;
      }

      if (!changed) {
        return state;
      }
      return {
        journal: nextJournal,
      };
    });
  },
  markPendingRecovery: (requestId) => {
    set((state) => {
      const { changed, nextEntries } = mapJournalEntries(
        state.journal,
        requestId,
        (entry) => (
          entry.status === "pending"
            ? {
                ...entry,
                pendingRecovery: true,
              }
            : entry
        ),
      );
      if (!changed) {
        return state;
      }
      return {
        journal: nextEntries,
      };
    });
  },
  ingestEvent: (event) => {
    usePlanetCommandStore.getState().reconcileAuthoritativeEvent(event);
  },
}));

export function getLatestCommandEntry(entries: PlanetCommandJournalEntry[]) {
  return entries[0];
}

export function getPendingCommandCount(entries: PlanetCommandJournalEntry[]) {
  return entries.filter((entry) => entry.status === "pending").length;
}
