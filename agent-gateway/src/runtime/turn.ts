import {
  runProviderTurnPipeline,
  type AgentTurnRunner,
  type AgentTurnRunnerInput,
} from './provider-turn-runner.js';

export type { AgentTurnRunner, AgentTurnRunnerInput } from './provider-turn-runner.js';

export const runProviderTurn: AgentTurnRunner = async (
  input: AgentTurnRunnerInput,
) => runProviderTurnPipeline(input);
