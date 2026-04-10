import { parseProviderResult } from './index.js';
import type { ProviderTurnResult } from './types.js';

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

export async function runOpenAICompatibleTurn(input: OpenAICompatibleTurnInput): Promise<ProviderTurnResult> {
  const firstContent = await requestProviderContent(input, input.userPrompt);
  try {
    return parseProviderResult(firstContent);
  } catch {
    const repairedContent = await requestProviderContent(
      input,
      [
        input.userPrompt,
        '上一次输出未通过校验。',
        '请只返回一个合法 JSON 对象，且必须包含 assistantMessage/actions/done 三个字段。',
        '不要输出 markdown、解释或额外文本。',
      ].join('\n\n'),
    );
    return parseProviderResult(repairedContent);
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
