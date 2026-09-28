import type { CommandResponse, EventSnapshotResponse } from "@shared/types";

import { toPlayerFacingMessage } from "@/common/player-facing-error";
import { sfx } from "@/engine/audio";
import { isNotificationsFrozen } from "@/features/notifications/notify";
import { useNotificationsStore } from "@/features/notifications/store";
import type { CommandJournalFocus } from "@/features/planet-commands/store";
import { usePlanetCommandStore } from "@/features/planet-commands/store";
import { translateCommandType } from "@/i18n/translate";

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

/**
 * 命令失败时弹全局 danger toast：工作台抽屉里的文字反馈不够显眼，
 * 玩家需要立刻知道「哪条命令失败、为什么」。
 */
function notifyCommandFailure(commandType: string, playerMessage: string) {
  if (isNotificationsFrozen()) {
    return;
  }
  useNotificationsStore.getState().push({
    kind: "danger",
    title: `${translateCommandType(commandType)}失败`,
    body: playerMessage,
    mergeKey: `command-fail:${commandType}`,
  });
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

    // 与战争页对齐：HTTP 接受/拒绝即刻反馈，不等权威回写。
    if (response.accepted) {
      sfx.commandOk();
    } else {
      sfx.commandFail();
      const rawMessage = response.results
        .map((result) => result.message)
        .filter(Boolean)
        .join(" / ");
      notifyCommandFailure(
        input.commandType,
        toPlayerFacingMessage(rawMessage || `${input.commandType} rejected`),
      );
    }

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
    const rawMessage = error instanceof Error
      ? error.message
      : `${input.commandType} failed`;
    const playerMessage = toPlayerFacingMessage(rawMessage);
    usePlanetCommandStore.getState().addJournalEntry({
      requestId: createLocalRequestId(input.commandType),
      commandType: input.commandType,
      planetId: input.planetId,
      status: "failed",
      acceptedMessage: `${input.commandType} 提交失败`,
      authoritativeCode: "LOCAL_ERROR",
      authoritativeMessage: playerMessage,
      debugMessage: rawMessage,
      authoritativeSource: "response",
      focus: input.focus,
      pendingRecovery: false,
    });
    sfx.commandFail();
    notifyCommandFailure(input.commandType, playerMessage);
    return undefined;
  }
}
