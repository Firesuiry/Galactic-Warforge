import { getAgentAllowedCommands } from '../../../client-cli/src/runtime.js';
import { runClaudeTurn } from '../providers/claude-cli.js';
import { runCodexTurn } from '../providers/codex-cli.js';
import { runOpenAICompatibleTurn } from '../providers/openai-compatible.js';
import type { ProviderTurnResult } from '../providers/types.js';
import type { CliProviderConfig, HttpApiProviderConfig, ModelProvider } from '../types.js';
import { ensureActionSchemaFile } from './action-schema.js';
import { classifyPublicTurnError } from './provider-error.js';

export interface SecretStore {
  readValue: (id: string) => Promise<string>;
}

export interface AgentTurnRunnerInput {
  dataRoot: string;
  provider: ModelProvider;
  secretStore: SecretStore;
  history: Array<{ role: string; content: string }>;
  allowedCommands?: string[];
  contextSections?: string[];
}

export type AgentTurnRunner = (input: AgentTurnRunnerInput) => Promise<ProviderTurnResult>;

function buildPrompt(input: AgentTurnRunnerInput) {
  const tools = (input.allowedCommands ?? getAgentAllowedCommands()).join(', ');
  const transcript = input.history.map((entry) => `${entry.role}: ${entry.content}`).join('\n');
  return [
    input.provider.systemPrompt || '你是 SiliconWorld 智能体。',
    '你必须返回 JSON，字段为 assistantMessage/actions/done。',
    '返回格式示例：{"assistantMessage":"收到。","actions":[],"done":true}',
    '如果本轮无需动作且已经完成，直接返回 assistantMessage + [] + true 即可。',
    '如果需要显式提交正式回复，也可以使用 final_answer；当两者同时存在时，以 final_answer 为准。',
    '允许的 game.cli 命令如下：',
    tools,
    ...(input.contextSections ?? []),
    '历史对话：',
    transcript,
  ].join('\n\n');
}

export const runProviderTurnPipeline: AgentTurnRunner = async (input) => {
  const prompt = buildPrompt(input);

  try {
    if (input.provider.providerKind === 'http_api') {
      const providerConfig = input.provider.providerConfig as HttpApiProviderConfig;
      const apiKey = await input.secretStore.readValue(providerConfig.apiKeySecretId);
      return await runOpenAICompatibleTurn({
        apiUrl: providerConfig.apiUrl,
        apiStyle: providerConfig.apiStyle,
        apiKey,
        model: providerConfig.model || input.provider.defaultModel,
        extraHeaders: providerConfig.extraHeaders,
        systemPrompt: input.provider.systemPrompt,
        userPrompt: prompt,
      });
    }

    if (input.provider.providerKind === 'codex_cli') {
      const providerConfig = input.provider.providerConfig as CliProviderConfig;
      const schemaFile = await ensureActionSchemaFile(input.dataRoot);
      return await runCodexTurn({
        command: providerConfig.command,
        model: providerConfig.model || input.provider.defaultModel,
        prompt,
        schemaFile,
        workdir: providerConfig.workdir,
        argsTemplate: providerConfig.argsTemplate,
        envOverrides: providerConfig.envOverrides,
      });
    }

    const providerConfig = input.provider.providerConfig as CliProviderConfig;
    return await runClaudeTurn({
      command: providerConfig.command,
      model: providerConfig.model || input.provider.defaultModel,
      prompt,
      schemaJson: JSON.stringify({
        type: 'object',
        required: ['assistantMessage', 'actions', 'done'],
        properties: {
          assistantMessage: { type: 'string' },
          actions: { type: 'array' },
          done: { type: 'boolean' },
        },
      }),
      systemPrompt: input.provider.systemPrompt,
      workdir: providerConfig.workdir,
      argsTemplate: providerConfig.argsTemplate,
      envOverrides: providerConfig.envOverrides,
    });
  } catch (error) {
    throw classifyPublicTurnError(error);
  }
};
