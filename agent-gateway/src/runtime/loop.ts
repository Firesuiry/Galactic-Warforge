import { assertSupportedAction } from './action-schema.js';

interface RunTurnInput {
  step: number;
  history: Array<{ role: string; content: string }>;
}

interface RunTurnResult {
  assistantMessage: string;
  actions: Array<Record<string, unknown>>;
  done: boolean;
}

export async function runAgentLoop(input: {
  maxSteps: number;
  provider: { runTurn: (request: RunTurnInput) => Promise<RunTurnResult> };
  cliRuntime: { run: (commandLine: string) => Promise<string> };
  initialContext: { goal: string };
  onAssistantMessage?: (message: string) => void;
  onToolCall?: (commandLine: string, result: string) => void;
}) {
  const history: Array<{ role: string; content: string }> = [
    { role: 'user', content: input.initialContext.goal },
  ];
  let finalMessage = '';

  for (let step = 0; step < input.maxSteps; step += 1) {
    const turn = await input.provider.runTurn({ step, history });
    history.push({ role: 'assistant', content: turn.assistantMessage });
    input.onAssistantMessage?.(turn.assistantMessage);

    for (const action of turn.actions) {
      assertSupportedAction(action);

      if (action.type === 'game.cli') {
        const commandLine = String(action.commandLine);
        const output = await input.cliRuntime.run(commandLine);
        history.push({ role: 'tool', content: output });
        input.onToolCall?.(commandLine, output);
        continue;
      }

      if (action.type === 'memory.note') {
        history.push({ role: 'tool', content: String(action.note ?? '') });
        continue;
      }

      if (action.type === 'final_answer') {
        finalMessage = String(action.message);
      }
    }

    if (turn.done) {
      return { finalMessage, history };
    }
  }

  throw new Error('agent loop exceeded maxSteps');
}
