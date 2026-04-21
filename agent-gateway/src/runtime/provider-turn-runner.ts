import { getAgentAllowedCommands } from '../../../client-cli/src/runtime.js';
import { runClaudeTurn } from '../providers/claude-cli.js';
import { runCodexTurn } from '../providers/codex-cli.js';
import { runOpenAICompatibleTurn } from '../providers/openai-compatible.js';
import type { ProviderTurnResult } from '../providers/types.js';
import type { CliProviderConfig, HttpApiProviderConfig, ModelProvider } from '../types.js';
import { ensureActionSchemaFile } from './action-schema.js';
import { listSupportedGameCommandsForPrompt } from './game-command-schema.js';
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
  const tools = listSupportedGameCommandsForPrompt(input.allowedCommands ?? getAgentAllowedCommands()).join(', ');
  const transcript = input.history.map((entry) => `${entry.role}: ${entry.content}`).join('\n');
  return [
    input.provider.systemPrompt || '你是 SiliconWorld 智能体。',
    '你必须返回 JSON，字段为 assistantMessage/actions/done。',
    '返回格式示例：{"assistantMessage":"收到。","actions":[],"done":true}',
    '如果本轮无需动作且已经完成，直接返回 assistantMessage + [] + true 即可。',
    '如果需要显式提交正式回复，也可以使用 final_answer；当两者同时存在时，以 final_answer 为准。',
    '游戏动作必须使用 typed game.command，例如 {"type":"game.command","command":"scan_planet","args":{"planetId":"planet-1-2"}}。',
    '如果要建造，使用 {"type":"game.command","command":"build","args":{"x":5,"y":1,"buildingType":"mining_machine"}}。',
    '如果要创建成员，可以只提供有意义的 partial policy，例如 {"type":"agent.create","name":"胡景","policy":{"planetIds":["planet-1-2"],"commandCategories":["build"]}}。',
    '观察类请求不能只回复计划句，必须返回至少 1 条 observe 类 game.command；变更类请求也不能只回复承诺句。',
    'few-shot 1：observe 第 1 轮可返回 {"assistantMessage":"先扫描当前行星。","actions":[{"type":"game.command","command":"scan_planet","args":{"planetId":"planet-1-2"}}],"done":false}；拿到 tool 结果后，必须再返回一句最终总结，例如 {"assistantMessage":"planet-1-2 当前安全。","actions":[],"done":true}。',
    'few-shot 2：agent.create 第 1 轮执行创建后，如果还需要等 tool 结果，done 设为 false；拿到结果后必须明确说“谁已创建、权限是什么”，不要只写“我现在创建”。',
    'few-shot 3：研究委派可先返回 transfer_item，再根据 tool 结果继续返回 start_research；如果已经有完整结果，最终一轮必须直接交付“装料是否成功、研究是否已启动或缺什么参数”。',
    'few-shot 4：如果 thread 历史里已经有 agent.create 的 tool 结果，后续再让你“新建一个矿场”时，必须直接复用该成员 id，返回 conversation.ensure_dm + conversation.send_message，不要假装不知道成员是谁。',
    'few-shot 5：军事委派若要求巡逻 / 护航，可先返回 task_force_set_stance + task_force_deploy，再用 system_runtime 获取局势；最终回复必须交付“做了什么 / 为什么 / 当前战区状态 / 是否需要玩家批准”。',
    '当前允许的 game.command 如下：',
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
