import { parseProviderResult } from './index.js';
import type { ProviderTurnResult } from './types.js';

interface OpenAICompatibleTurnInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}

export async function runOpenAICompatibleTurn(input: OpenAICompatibleTurnInput): Promise<ProviderTurnResult> {
  const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`openai compatible request failed: ${response.status}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('openai compatible response missing content');
  }

  return parseProviderResult(content);
}

export async function probeOpenAICompatible(baseUrl: string, apiKey: string, model: string) {
  try {
    await runOpenAICompatibleTurn({
      baseUrl,
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
