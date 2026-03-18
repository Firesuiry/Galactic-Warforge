import { SERVER_URL, SSE_BUFFER_SIZE } from './config.js';
import type { GameEvent } from './types.js';

const eventBuffer: GameEvent[] = [];
let sseController: AbortController | null = null;
let sseRunning = false;
let retryDelay = 1000;
let onEventPrint: ((e: GameEvent) => void) | null = null;

export function setEventPrinter(fn: (e: GameEvent) => void) {
  onEventPrint = fn;
}

export function getEventBuffer(): GameEvent[] {
  return [...eventBuffer];
}

export function startSSE(playerKey: string) {
  sseRunning = true;
  retryDelay = 1000;
  connectSSE(playerKey);
}

export function stopSSE() {
  sseRunning = false;
  sseController?.abort();
  sseController = null;
}

async function connectSSE(playerKey: string) {
  if (!sseRunning) return;

  sseController = new AbortController();
  const signal = sseController.signal;

  try {
    const res = await fetch(`${SERVER_URL}/events/stream`, {
      headers: { Authorization: `Bearer ${playerKey}` },
      signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`SSE connect failed: ${res.status}`);
    }

    retryDelay = 1000;
    await readStream(res.body);
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError' || !sseRunning) return;
    // silently retry
  }

  if (sseRunning) {
    setTimeout(() => connectSSE(playerKey), retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
  }
}

async function readStream(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = processBuffer(buffer);
  }
}

function processBuffer(buffer: string): string {
  const blocks = buffer.split('\n\n');
  const remaining = blocks.pop() ?? '';

  for (const block of blocks) {
    if (!block.trim()) continue;
    const parsed = parseSSEBlock(block);
    if (parsed.eventType === 'game' && parsed.data) {
      try {
        const evt = JSON.parse(parsed.data) as GameEvent;
        pushEvent(evt);
      } catch { /* ignore */ }
    }
  }

  return remaining;
}

function pushEvent(evt: GameEvent) {
  if (eventBuffer.length >= SSE_BUFFER_SIZE) {
    eventBuffer.shift();
  }
  eventBuffer.push(evt);
  onEventPrint?.(evt);
}

function parseSSEBlock(block: string): { eventType: string; data: string } {
  let eventType = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data += line.slice(5).trim();
    }
  }
  return { eventType, data };
}
