import { createSseClient } from '../../shared-client/src/sse.js';
import {
  ALL_EVENT_TYPES,
  DEFAULT_EVENT_TYPES,
  SERVER_URL,
  SSE_BUFFER_SIZE,
  SSE_SILENT_EVENT_TYPES,
  SSE_VERBOSE,
} from './config.js';
import type { SseEvent } from './types.js';

const sseClient = createSseClient({
  serverUrl: SERVER_URL,
  bufferSize: SSE_BUFFER_SIZE,
});

let onEventPrint: ((event: SseEvent) => void) | null = null;

export function setEventPrinter(fn: (event: SseEvent) => void) {
  onEventPrint = fn;
}

export function getEventBuffer(): SseEvent[] {
  return sseClient.getEventBuffer();
}

export function startSSE(playerKey: string) {
  sseClient.start({
    playerKey,
    eventTypes: SSE_VERBOSE ? [...ALL_EVENT_TYPES] : [...DEFAULT_EVENT_TYPES],
    onEvent: (event) => {
      if (!SSE_VERBOSE && event.type === 'game' && SSE_SILENT_EVENT_TYPES.has(event.event.event_type)) {
        return;
      }
      onEventPrint?.(event);
    },
  });
}

export function stopSSE() {
  sseClient.stop();
}
