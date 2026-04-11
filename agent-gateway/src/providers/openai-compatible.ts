import { parseProviderResult } from './index.js';
import type { ProviderTurnResult } from './types.js';
import { normalizeProviderTurn } from '../runtime/action-schema.js';

interface OpenAICompatibleTurnInput {
  apiUrl: string;
  apiStyle: 'openai' | 'claude';
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
  systemPrompt: string;
  userPrompt: string;
}

function buildOpenAIHeaders(input: OpenAICompatibleTurnInput) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${input.apiKey}`,
    ...(input.extraHeaders ?? {}),
  };
}

function buildClaudeHeaders(input: OpenAICompatibleTurnInput) {
  return {
    'content-type': 'application/json',
    'x-api-key': input.apiKey,
    'anthropic-version': '2023-06-01',
    ...(input.extraHeaders ?? {}),
  };
}

function extractOpenAIContent(payload: {
  choices?: Array<{ message?: { content?: string } }>;
}) {
  return payload.choices?.[0]?.message?.content;
}

function extractClaudeContent(payload: {
  content?: Array<{ type?: string; text?: string }>;
}) {
  return payload.content
    ?.find((entry) => entry.type === 'text' && typeof entry.text === 'string')
    ?.text;
}

async function requestProviderContent(
  input: OpenAICompatibleTurnInput,
  userPrompt: string,
) {
  const normalizedApiUrl = input.apiUrl.replace(/\/$/, '');
  const response = await fetch(
    input.apiStyle === 'claude' ? `${normalizedApiUrl}/messages` : `${normalizedApiUrl}/chat/completions`,
    {
      method: 'POST',
      headers: input.apiStyle === 'claude' ? buildClaudeHeaders(input) : buildOpenAIHeaders(input),
      body: JSON.stringify(
        input.apiStyle === 'claude'
          ? {
              model: input.model,
              system: input.systemPrompt,
              messages: [{ role: 'user', content: userPrompt }],
              max_tokens: 1024,
            }
          : {
              model: input.model,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: input.systemPrompt },
                { role: 'user', content: userPrompt },
              ],
            },
      ),
    },
  );

  if (!response.ok) {
    throw new Error(`http api request failed: ${response.status}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    content?: Array<{ type?: string; text?: string }>;
  };
  const content = input.apiStyle === 'claude'
    ? extractClaudeContent(payload)
    : extractOpenAIContent(payload);

  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('http api response missing content');
  }

  return content;
}

function validateProviderContent(raw: string): ProviderTurnResult {
  return normalizeProviderTurn(parseProviderResult(raw));
}

function buildFieldLevelExample(errorMessage: string) {
  const normalized = errorMessage.toLowerCase();

  if (normalized.includes('transfer_item requires buildingid')) {
    return [
      '如果你要给 b-9 装料，必须返回：',
      '{"assistantMessage":"已把 10 个 electromagnetic_matrix 装入 b-9。","actions":[{"type":"game.command","command":"transfer_item","args":{"buildingId":"b-9","itemId":"electromagnetic_matrix","quantity":10}}],"done":false}',
    ].join('\n');
  }

  if (normalized.includes('transfer_item requires itemid')) {
    return [
      'transfer_item 必须同时包含目标建筑、物品 ID 和数量，例如：',
      '{"assistantMessage":"已准备装料。","actions":[{"type":"game.command","command":"transfer_item","args":{"buildingId":"b-9","itemId":"electromagnetic_matrix","quantity":10}}],"done":false}',
    ].join('\n');
  }

  if (normalized.includes('start_research requires techid')) {
    return [
      '如果你要启动科研，techId 不能为空，例如：',
      '{"assistantMessage":"准备启动科研。","actions":[{"type":"game.command","command":"start_research","args":{"techId":"basic_logistics_system"}}],"done":false}',
    ].join('\n');
  }

  if (normalized.includes('build requires buildingtype')) {
    return [
      '如果你要建造建筑，buildingType 不能为空，例如：',
      '{"assistantMessage":"准备建造研究站。","actions":[{"type":"game.command","command":"build","args":{"x":5,"y":1,"buildingType":"matrix_lab"}}],"done":false}',
    ].join('\n');
  }

  return [
    '最小合法示例：',
    '{"assistantMessage":"收到。","actions":[],"done":true}',
  ].join('\n');
}

function buildRepairPrompt(originalPrompt: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    originalPrompt,
    `上一轮结构错误：${message}。`,
    buildFieldLevelExample(message),
    '请返回修正后的完整 JSON。',
    '只允许输出一个 JSON 对象，不要输出 markdown、解释或额外文本。',
  ].join('\n\n');
}

export async function runOpenAICompatibleTurn(input: OpenAICompatibleTurnInput): Promise<ProviderTurnResult> {
  const firstContent = await requestProviderContent(input, input.userPrompt);
  try {
    return validateProviderContent(firstContent);
  } catch (error) {
    const repairedContent = await requestProviderContent(
      input,
      buildRepairPrompt(input.userPrompt, error),
    );
    return validateProviderContent(repairedContent);
  }
}

export async function probeOpenAICompatible(
  apiUrl: string,
  apiKey: string,
  model: string,
  apiStyle: 'openai' | 'claude' = 'openai',
) {
  try {
    await runOpenAICompatibleTurn({
      apiUrl,
      apiStyle,
      apiKey,
      model,
      systemPrompt: 'Return a valid JSON object that matches the requested schema.',
      userPrompt: JSON.stringify({
        assistantMessage: 'probe',
        actions: [],
        done: true,
      }),
    });
    return { available: true };
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
