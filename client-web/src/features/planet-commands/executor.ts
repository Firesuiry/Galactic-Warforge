import type { CommandResponse, EventSnapshotResponse } from "@shared/types";

import {
  isGameFinishedResult,
  rejectionPlayerMessage,
  toPlayerFacingMessage,
} from "@/common/player-facing-error";
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

/** 本地预检拦截的节流窗口（ms）：消退后此时长内同原因只进历史，不再弹（连点不刷屏）。 */
const LOCAL_BLOCK_THROTTLE_MS = 8000;

/**
 * 命令失败时弹全局 danger toast：工作台抽屉里的文字反馈不够显眼，
 * 玩家需要立刻知道「哪条命令失败、为什么」。
 *
 * throttleMs 只给本地预检拦截用（同原因连点合并计数 + 消退后节流）；
 * 服务端拒绝是每次操作的真实结论，不节流。
 */
function notifyCommandFailure(commandType: string, playerMessage: string, href?: string, throttleMs?: number) {
  if (isNotificationsFrozen()) {
    return;
  }
  useNotificationsStore.getState().push({
    kind: "danger",
    title: href ? "对局已结束" : `${translateCommandType(commandType)}失败`,
    body: playerMessage,
    href,
    mergeKey: href ? "command-fail:GAME_FINISHED" : `command-fail:${commandType}`,
    ...(throttleMs ? { throttleMs } : {}),
  });
}

/**
 * 本地预检拦截（缺料 / 占格 / 资源点 / 无选中单位…）也走同一条全局 danger toast：
 * 这类拦截根本不下发命令，若只写 journal 条目，玩家在工作台抽屉关闭时（默认布局）
 * 拿不到任何持久反馈，触屏/笔更没有 hover 提示，观感就是「点了没反应」（试玩 1014 层 01 P1）。
 * 同 mergeKey 在窗口内合并计数、消退后节流，避免连续点同一原因刷屏。
 */
export function notifyLocalBlock(commandType: string, playerMessage: string) {
  notifyCommandFailure(commandType, playerMessage, undefined, LOCAL_BLOCK_THROTTLE_MS);
}

export async function submitPlanetCommand(input: SubmitPlanetCommandInput) {
  // 下发前先写一条本地占位：请求在途时「最新反馈」立刻变成这条命令，
  // 不再残留上一条命令的结果（试玩 1013 H）。回执到达后按 localRequestId 原位替换。
  const localRequestId = createLocalRequestId(input.commandType);
  usePlanetCommandStore.getState().addJournalEntry({
    requestId: localRequestId,
    commandType: input.commandType,
    planetId: input.planetId,
    status: "pending",
    acceptedMessage: `${translateCommandType(input.commandType)}已提交，等待服务器确认…`,
    focus: input.focus,
    pendingRecovery: false,
  });
  try {
    const response = await input.execute();
    usePlanetCommandStore.getState().reconcileAcceptedResponse({
      commandType: input.commandType,
      planetId: input.planetId,
      response,
      focus: input.focus,
      localRequestId,
    });

    // 与战争页对齐：HTTP 接受/拒绝即刻反馈，不等权威回写。
    if (response.accepted) {
      sfx.commandOk();
    } else {
      sfx.commandFail();
      const finished = response.results.some((result) => isGameFinishedResult(result));
      notifyCommandFailure(
        input.commandType,
        rejectionPlayerMessage(response.results, `${input.commandType} rejected`),
        finished ? "/settlement" : undefined,
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
    // 原位把占位条目改成失败，保持它在队列里的位置（提交失败也是一次「本次操作」的结论）。
    usePlanetCommandStore.getState().addJournalEntry({
      requestId: localRequestId,
      commandType: input.commandType,
      planetId: input.planetId,
      status: "failed",
      acceptedMessage: `${translateCommandType(input.commandType)}提交失败`,
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
