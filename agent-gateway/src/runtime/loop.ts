import { PublicTurnError } from './provider-error.js';
import type { CanonicalAgentAction } from './action-schema.js';
import { normalizeProviderTurn } from './action-schema.js';
import { executeGameCommand } from './game-command-executor.js';
import { classifyTurnIntent } from './turn-intent.js';
import {
  buildRepairPrompt,
  countsAsExecutedAction,
  resolveTurnOutcomeKind,
  validateTurnForIntent,
  type TurnOutcomeKind,
} from './turn-validator.js';

interface RunTurnInput {
  step: number;
  history: Array<{ role: string; content: string }>;
}

interface GatewayRuntime {
  createAgent?: (
    action: Extract<CanonicalAgentAction, { type: 'agent.create' }>,
  ) => Promise<string>;
  updateAgent?: (
    action: Extract<CanonicalAgentAction, { type: 'agent.update' }>,
  ) => Promise<string>;
  ensureDirectConversation?: (
    action: Extract<CanonicalAgentAction, { type: 'conversation.ensure_dm' }>,
  ) => Promise<string>;
  sendConversationMessage?: (
    action: Extract<CanonicalAgentAction, { type: 'conversation.send_message' }>,
  ) => Promise<string>;
}

export async function runAgentLoop(input: {
  maxSteps: number;
  provider: { runTurn: (request: RunTurnInput) => Promise<unknown> };
  cliRuntime: { run: (commandLine: string) => Promise<string> };
  gatewayRuntime?: GatewayRuntime;
  initialContext: { goal: string };
  initialHistory?: Array<{ role: string; content: string }>;
  onAssistantMessage?: (message: string) => void;
  onToolCall?: (commandLine: string, result: string) => void;
  onTurnPrepared?: (input: {
    step: number;
    assistantMessage: string;
    actions: CanonicalAgentAction[];
    done: boolean;
    repairCount: number;
  }) => Promise<void> | void;
  onActionUpdate?: (input: {
    step: number;
    actionIndex: number;
    action: CanonicalAgentAction;
    status: 'pending' | 'succeeded' | 'failed';
    detail: string;
  }) => Promise<void> | void;
}) {
  const history: Array<{ role: string; content: string }> = input.initialHistory
    ? [...input.initialHistory]
    : [{ role: 'user', content: input.initialContext.goal }];
  const intent = classifyTurnIntent(history);
  const executedActions: CanonicalAgentAction[] = [];
  let finalMessage = '';
  let totalRepairCount = 0;

  for (let step = 0; step < input.maxSteps; step += 1) {
    let turn = normalizeProviderTurn(await input.provider.runTurn({ step, history }));
    let stepRepairCount = 0;
    let validation = validateTurnForIntent(turn, intent, stepRepairCount, executedActions);

    while (validation.needsRepair) {
      history.push({ role: 'assistant', content: turn.assistantMessage });
      history.push({ role: 'user', content: buildRepairPrompt(intent) });
      stepRepairCount += 1;
      totalRepairCount += 1;
      turn = normalizeProviderTurn(await input.provider.runTurn({ step, history }));
      validation = validateTurnForIntent(turn, intent, stepRepairCount, executedActions);
    }

    history.push({ role: 'assistant', content: turn.assistantMessage });
    input.onAssistantMessage?.(turn.assistantMessage);
    await input.onTurnPrepared?.({
      step,
      assistantMessage: turn.assistantMessage,
      actions: turn.actions,
      done: turn.done,
      repairCount: stepRepairCount,
    });

    if (!validation.valid) {
      throw new PublicTurnError(
        'provider_incomplete_execution',
        validation.errorMessage ?? 'provider_incomplete_execution',
      );
    }

    for (const [actionIndex, action] of turn.actions.entries()) {
      await input.onActionUpdate?.({
        step,
        actionIndex,
        action,
        status: 'pending',
        detail: action.type,
      });

      try {
        if (action.type === 'game.command') {
          const execution = await executeGameCommand(action, input.cliRuntime);
          history.push({ role: 'tool', content: execution.result });
          input.onToolCall?.(execution.commandLine, execution.result);
          if (countsAsExecutedAction(action)) {
            executedActions.push(action);
          }
          await input.onActionUpdate?.({
            step,
            actionIndex,
            action,
            status: 'succeeded',
            detail: execution.result,
          });
          continue;
        }

        if (action.type === 'memory.note') {
          history.push({ role: 'tool', content: action.note });
          await input.onActionUpdate?.({
            step,
            actionIndex,
            action,
            status: 'succeeded',
            detail: action.note,
          });
          continue;
        }

        if (action.type === 'agent.create') {
          if (!input.gatewayRuntime?.createAgent) {
            throw new Error('agent.create is not supported in this runtime');
          }
          const result = await input.gatewayRuntime.createAgent(action);
          history.push({ role: 'tool', content: result });
          if (countsAsExecutedAction(action)) {
            executedActions.push(action);
          }
          await input.onActionUpdate?.({
            step,
            actionIndex,
            action,
            status: 'succeeded',
            detail: result,
          });
          continue;
        }

        if (action.type === 'agent.update') {
          if (!input.gatewayRuntime?.updateAgent) {
            throw new Error('agent.update is not supported in this runtime');
          }
          const result = await input.gatewayRuntime.updateAgent(action);
          history.push({ role: 'tool', content: result });
          if (countsAsExecutedAction(action)) {
            executedActions.push(action);
          }
          await input.onActionUpdate?.({
            step,
            actionIndex,
            action,
            status: 'succeeded',
            detail: result,
          });
          continue;
        }

        if (action.type === 'conversation.ensure_dm') {
          if (!input.gatewayRuntime?.ensureDirectConversation) {
            throw new Error('conversation.ensure_dm is not supported in this runtime');
          }
          const result = await input.gatewayRuntime.ensureDirectConversation(action);
          history.push({ role: 'tool', content: result });
          if (countsAsExecutedAction(action)) {
            executedActions.push(action);
          }
          await input.onActionUpdate?.({
            step,
            actionIndex,
            action,
            status: 'succeeded',
            detail: result,
          });
          continue;
        }

        if (action.type === 'conversation.send_message') {
          if (!input.gatewayRuntime?.sendConversationMessage) {
            throw new Error('conversation.send_message is not supported in this runtime');
          }
          const result = await input.gatewayRuntime.sendConversationMessage(action);
          history.push({ role: 'tool', content: result });
          if (countsAsExecutedAction(action)) {
            executedActions.push(action);
          }
          await input.onActionUpdate?.({
            step,
            actionIndex,
            action,
            status: 'succeeded',
            detail: result,
          });
          continue;
        }

        if (action.type === 'final_answer') {
          finalMessage = action.message;
          await input.onActionUpdate?.({
            step,
            actionIndex,
            action,
            status: 'succeeded',
            detail: action.message,
          });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await input.onActionUpdate?.({
          step,
          actionIndex,
          action,
          status: 'failed',
          detail,
        });
        throw error;
      }
    }

    if (turn.done) {
      const outcomeKind = resolveTurnOutcomeKind(executedActions);
      if (finalMessage.trim()) {
        return {
          finalMessage,
          history,
          outcomeKind,
          executedActionCount: executedActions.length,
          repairCount: totalRepairCount,
        };
      }
      if (turn.assistantMessage.trim()) {
        return {
          finalMessage: turn.assistantMessage,
          history,
          outcomeKind,
          executedActionCount: executedActions.length,
          repairCount: totalRepairCount,
        };
      }
      throw new PublicTurnError(
        'provider_schema_invalid',
        'provider_schema_invalid: done turn missing assistantMessage and final_answer',
      );
    }
  }

  throw new Error('agent loop exceeded maxSteps');
}

export type RunAgentLoopResult = Awaited<ReturnType<typeof runAgentLoop>> & {
  outcomeKind: TurnOutcomeKind;
  executedActionCount: number;
  repairCount: number;
};
