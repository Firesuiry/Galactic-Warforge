import { useState } from 'react';

import type { CommandResult } from '@shared/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';

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
        ? buildWarSuccessHint(result?.message)
        : resolveWarCommandHint(result?.message)
          ?? {
            tone: 'warning',
            title: result?.message || '命令未返回结果',
          };
      pushFeedback(setFeedbacks, input.section, hint);
      input.invalidateKeys.forEach((queryKey) => {
        void queryClient.invalidateQueries({ queryKey });
      });
    },
    onError: (error, input) => {
      pushFeedback(setFeedbacks, input.section, {
        tone: 'error',
        title: error instanceof Error ? error.message : '命令提交失败',
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
  setFeedbacks((current) => {
    const previous = current[section] ?? [];
    return {
      ...current,
      [section]: [hint, ...previous].slice(0, 4),
    };
  });
}

export type { CommandResult };
