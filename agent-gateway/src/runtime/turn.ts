import { getAgentAllowedCommands } from '../../../client-cli/src/runtime.js';
import { runClaudeTurn } from '../providers/claude-cli.js';
import { runCodexTurn } from '../providers/codex-cli.js';
import { runOpenAICompatibleTurn } from '../providers/openai-compatible.js';
import type { ProviderTurnResult } from '../providers/types.js';
import { ensureActionSchemaFile } from './action-schema.js';
import type { AgentTemplate, CliProviderConfig, OpenAICompatibleProviderConfig } from '../types.js';

interface SecretStore {
  readValue: (id: string) => Promise<string>;
}

export interface AgentTurnRunnerInput {
  dataRoot: string;
  template: AgentTemplate;
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
    input.template.systemPrompt || '你是 SiliconWorld 智能体。',
    '你必须返回 JSON，字段为 assistantMessage/actions/done。',
    '允许的 game.cli 命令如下：',
    tools,
    ...(input.contextSections ?? []),
    '历史对话：',
    transcript,
  ].join('\n\n');
}

export const runTemplateTurn: AgentTurnRunner = async (input: AgentTurnRunnerInput) => {
  const prompt = buildPrompt(input);

  if (input.template.providerKind === 'openai_compatible_http') {
    const providerConfig = input.template.providerConfig as OpenAICompatibleProviderConfig;
    const apiKey = await input.secretStore.readValue(providerConfig.apiKeySecretId);
    return runOpenAICompatibleTurn({
      baseUrl: providerConfig.baseUrl,
      apiKey,
      model: providerConfig.model || input.template.defaultModel,
      systemPrompt: input.template.systemPrompt,
      userPrompt: prompt,
    });
  }

  if (input.template.providerKind === 'codex_cli') {
    const providerConfig = input.template.providerConfig as CliProviderConfig;
    const schemaFile = await ensureActionSchemaFile(input.dataRoot);
    return runCodexTurn({
      command: providerConfig.command,
      model: providerConfig.model || input.template.defaultModel,
      prompt,
      schemaFile,
      workdir: providerConfig.workdir,
    });
  }

  const providerConfig = input.template.providerConfig as CliProviderConfig;
  return runClaudeTurn({
    command: providerConfig.command,
    model: providerConfig.model || input.template.defaultModel,
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
    systemPrompt: input.template.systemPrompt,
  });
};
