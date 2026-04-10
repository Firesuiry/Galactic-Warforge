import type { CommandResponse, EventSnapshotResponse } from "@shared/types";

import type { CommandJournalFocus } from "@/features/planet-commands/store";
import { usePlanetCommandStore } from "@/features/planet-commands/store";

export interface SubmitPlanetCommandInput {
  commandType: string;
  planetId: string;
  focus?: CommandJournalFocus;
  execute: () => Promise<CommandResponse>;
  fetchAuthoritativeSnapshot?: (input: {
    planetId: string;
    requestId: string;
  }) => Promise<EventSnapshotResponse>;
  recoveryTimeoutMs?: number;
}

function createLocalRequestId(commandType: string) {
  return globalThis.crypto?.randomUUID?.()
    ?? `local-${commandType}-${Date.now()}`;
}

export async function submitPlanetCommand(input: SubmitPlanetCommandInput) {
  try {
    const response = await input.execute();
    usePlanetCommandStore.getState().reconcileAcceptedResponse({
      commandType: input.commandType,
      planetId: input.planetId,
      response,
      focus: input.focus,
    });

    if (response.accepted && input.fetchAuthoritativeSnapshot) {
      window.setTimeout(async () => {
        const latestEntry = usePlanetCommandStore
          .getState()
          .journal.find((entry) => entry.requestId === response.request_id);
        if (!latestEntry || latestEntry.status !== "pending") {
          return;
        }

        usePlanetCommandStore.getState().markPendingRecovery(response.request_id);
        try {
          const snapshot = await input.fetchAuthoritativeSnapshot?.({
            planetId: input.planetId,
            requestId: response.request_id,
          });
          if (!snapshot) {
            return;
          }
          const pendingEntry = usePlanetCommandStore
            .getState()
            .journal.find((entry) => entry.requestId === response.request_id);
          if (!pendingEntry || pendingEntry.status !== "pending") {
            return;
          }
          usePlanetCommandStore.getState().hydrateAuthoritativeSnapshot(snapshot);
        } catch {
          // Keep the journal entry pending; the next SSE reconnect or manual refresh can recover it.
        }
      }, input.recoveryTimeoutMs ?? 1600);
    }

    return response;
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : `${input.commandType} failed`;
    usePlanetCommandStore.getState().addJournalEntry({
      requestId: createLocalRequestId(input.commandType),
      commandType: input.commandType,
      planetId: input.planetId,
      status: "failed",
      acceptedMessage: `${input.commandType} 提交失败`,
      authoritativeCode: "LOCAL_ERROR",
      authoritativeMessage: message,
      authoritativeSource: "response",
      focus: input.focus,
      pendingRecovery: false,
    });
    return undefined;
  }
}
