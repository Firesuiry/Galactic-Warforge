import { useState } from 'react';

import type { CommandResult } from '@shared/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { sfx } from '@/engine/audio';
import { toPlayerFacingMessage } from '@/common/player-facing-error';
import { buildWarSuccessHint, resolveWarCommandHint, type WarCommandHint } from '@/features/war/error-hints';
import type { FeedbackSection, WarCommandInput } from '@/features/war/war-query-keys';

export interface UseWarCommandResult {
  runCommand: (input: WarCommandInput) => void;
  notify: (section: FeedbackSection, hint: WarCommandHint) => void;
  feedbacks: Partial<Record<FeedbackSection, WarCommandHint[]>>;
  isPending: boolean;
}

/**
 * 战争工作台的命令提交管道。
 *
 * 把原本内联在 WarPage 里的 commandMutation + setFeedbacks 抽出，
 * 让新表单子组件共享同一份提交/反馈/失效逻辑，而不必各自重复 mutation。
 */
export function useWarCommand(): UseWarCommandResult {
  const queryClient = useQueryClient();
  const [feedbacks, setFeedbacks] = useState<Partial<Record<FeedbackSection, WarCommandHint[]>>>({});

  const commandMutation = useMutation({
    mutationFn: async (input: WarCommandInput) => {
      const response = await input.execute();
      const result = response.results[0];
      return { input, result };
    },
    onSuccess: ({ input, result }) => {
      const hint: WarCommandHint = result?.status === 'executed'
        || result?.status === 'accepted'
        || result?.status === 'queued'
        ? buildWarSuccessHint(result?.message)
        : resolveWarCommandHint(result?.message)
          ?? {
            tone: 'warning',
            title: toPlayerFacingMessage(result?.message),
          };
      pushFeedback(setFeedbacks, input.section, hint);
      input.invalidateKeys.forEach((queryKey) => {
        void queryClient.invalidateQueries({ queryKey });
      });
    },
    onError: (error, input) => {
      pushFeedback(setFeedbacks, input.section, {
        tone: 'error',
        title: error instanceof Error ? toPlayerFacingMessage(error.message) : '命令提交失败',
      });
    },
  });

  return {
    runCommand: (input) => commandMutation.mutate(input),
    notify: (section, hint) => pushFeedback(setFeedbacks, section, hint),
    feedbacks,
    isPending: commandMutation.isPending,
  };
}

function pushFeedback(
  setFeedbacks: React.Dispatch<React.SetStateAction<Partial<Record<FeedbackSection, WarCommandHint[]>>>>,
  section: FeedbackSection,
  hint: WarCommandHint,
) {
  // 指令反馈音：成功双音上行 / 失败低音下行（无 AudioContext 环境自动 no-op）
  if (hint.tone === 'success') {
    sfx.commandOk();
  } else {
    sfx.commandFail();
  }
  setFeedbacks((current) => {
    const previous = current[section] ?? [];
    return {
      ...current,
      [section]: [hint, ...previous].slice(0, 4),
    };
  });
}

export type { CommandResult };
