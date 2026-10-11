/**
 * 本地预检拦截（缺料 / 占格 / 资源点 / 无选中单位…）的统一回执。
 *
 * 这类拦截根本不下发 `/commands`，所以走不到 executor 的失败 toast 通道。
 * 只写命令 journal（工作台抽屉里的「最新反馈」）时，抽屉默认关闭的布局下玩家
 * 拿不到任何持久反馈；触屏/笔也没有 pointermove 的鼠标旁提示，观感就是
 * 「点了没反应、像卡了」（试玩 1014 层 01 P1）。
 *
 * 因此这里两件事一起做：
 * 1. 写 journal 失败条目（authoritativeCode = LOCAL_PREFLIGHT，抽屉打开时可见）；
 * 2. 弹全局 danger toast（与服务器拒绝同一通道，同原因合并/节流，见 executor.notifyLocalBlock）。
 */

import { sfx } from '@/engine/audio';
import { notifyLocalBlock } from '@/features/planet-commands/executor';
import { usePlanetCommandStore, type CommandJournalFocus } from '@/features/planet-commands/store';

export function reportLocalPreflightBlock(
  commandType: string,
  planetId: string,
  message: string,
  focus?: CommandJournalFocus,
) {
  usePlanetCommandStore.getState().addJournalEntry({
    requestId: globalThis.crypto?.randomUUID?.() ?? `local-block-${Date.now()}`,
    commandType,
    planetId,
    status: 'failed',
    acceptedMessage: `${commandType} 未下达`,
    authoritativeCode: 'LOCAL_PREFLIGHT',
    authoritativeMessage: message,
    authoritativeSource: 'response',
    focus,
    pendingRecovery: false,
  });
  notifyLocalBlock(commandType, message);
  sfx.commandFail();
}
