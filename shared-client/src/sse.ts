import { DEFAULT_EVENT_TYPES, DEFAULT_SSE_BUFFER_SIZE } from './config.js';
import type { GameEvent, SseEvent } from './types.js';
import { resolveServerUrl } from './utils.js';

export type SseStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped';

export interface SseClientOptions {
  serverUrl: string;
  fetchFn?: typeof fetch;
  bufferSize?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  /**
   * 静默看门狗阈值：超过该时长未收到任何字节（含服务端心跳注释行）就
   * 判定连接已死并主动重连。服务端心跳间隔 25s，默认阈值 75s = 3 个心跳。
   * 解决不稳定网络下 TCP 半开（读不到 FIN）导致客户端一直假“已连接”的问题。
   */
  heartbeatTimeoutMs?: number;
}

export interface StartSseOptions {
  playerKey: string;
  eventTypes?: readonly string[];
  onEvent?: (event: SseEvent) => void;
  onStatusChange?: (status: SseStatus) => void;
}

export function createSseClient(options: SseClientOptions) {
  let serverUrl = options.serverUrl;
  let controller: AbortController | null = null;
  let running = false;
  let status: SseStatus = 'idle';
  let retryDelayMs = options.initialRetryDelayMs ?? 1000;
  let startOptions: StartSseOptions | null = null;
  const bufferSize = options.bufferSize ?? DEFAULT_SSE_BUFFER_SIZE;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 75_000;
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  const eventBuffer: SseEvent[] = [];
  const eventListeners = new Set<(event: SseEvent) => void>();
  const statusListeners = new Set<(nextStatus: SseStatus) => void>();
  let lastActivityAt = 0;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let abortedByWatchdog = false;

  function setStatus(nextStatus: SseStatus) {
    status = nextStatus;
    startOptions?.onStatusChange?.(status);
    statusListeners.forEach((listener) => listener(status));
  }

  function emitEvent(event: SseEvent) {
    if (eventBuffer.length >= bufferSize) {
      eventBuffer.shift();
    }
    eventBuffer.push(event);
    startOptions?.onEvent?.(event);
    eventListeners.forEach((listener) => listener(event));
  }

  function subscribe(listener: (event: SseEvent) => void) {
    eventListeners.add(listener);
    return () => {
      eventListeners.delete(listener);
    };
  }

  function subscribeStatus(listener: (nextStatus: SseStatus) => void) {
    statusListeners.add(listener);
    return () => {
      statusListeners.delete(listener);
    };
  }

  function startWatchdog() {
    stopWatchdog();
    lastActivityAt = Date.now();
    watchdogTimer = setInterval(() => {
      if (!running || !controller) {
        return;
      }
      if (Date.now() - lastActivityAt > heartbeatTimeoutMs) {
        // 连接已静默死亡：主动 abort 触发重连（与 stop() 的用户主动断开区分）
        abortedByWatchdog = true;
        controller.abort();
      }
    }, Math.min(heartbeatTimeoutMs / 3, 15_000));
  }

  function stopWatchdog() {
    if (watchdogTimer !== null) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function stop() {
    running = false;
    stopWatchdog();
    controller?.abort();
    controller = null;
    setStatus('stopped');
  }

  function start(nextOptions: StartSseOptions) {
    stop();
    running = true;
    retryDelayMs = options.initialRetryDelayMs ?? 1000;
    startOptions = nextOptions;
    void connect();
  }

  async function connect() {
    if (!running || !startOptions) {
      return;
    }

    controller = new AbortController();
    abortedByWatchdog = false;
    setStatus(status === 'idle' || status === 'stopped' ? 'connecting' : 'reconnecting');

    const eventTypes = startOptions.eventTypes ?? DEFAULT_EVENT_TYPES;
    const query = new URLSearchParams({
      event_types: eventTypes.join(','),
    }).toString();

    try {
      const response = await fetchFn(resolveServerUrl(serverUrl, `/events/stream?${query}`), {
        headers: {
          Authorization: `Bearer ${startOptions.playerKey}`,
        },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`SSE connect failed: ${response.status}`);
      }

      retryDelayMs = options.initialRetryDelayMs ?? 1000;
      setStatus('connected');
      startWatchdog();
      await readStream(response.body);
    } catch (error) {
      if (!running) {
        return;
      }
      // 用户主动 stop() 的 abort 不重连；看门狗判死的 abort 走重连
      if ((error as Error).name === 'AbortError' && !abortedByWatchdog) {
        return;
      }
    } finally {
      stopWatchdog();
    }

    if (!running) {
      return;
    }

    setStatus('reconnecting');
    setTimeout(() => {
      void connect();
    }, retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, maxRetryDelayMs);
  }

  async function readStream(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (running) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      lastActivityAt = Date.now();
      buffer += decoder.decode(value, { stream: true });
      buffer = processBuffer(buffer);
    }
  }

  function processBuffer(buffer: string): string {
    const blocks = buffer.split('\n\n');
    const remaining = blocks.pop() ?? '';

    blocks.forEach((block) => {
      if (!block.trim()) {
        return;
      }
      const parsed = parseSseBlock(block);
      if (parsed.eventType === 'game' && parsed.data) {
        try {
          const event = JSON.parse(parsed.data) as GameEvent;
          emitEvent({ type: 'game', event });
        } catch {
          // ignore malformed event payload
        }
        return;
      }

      if (parsed.eventType === 'connected' && parsed.data) {
        try {
          const payload = JSON.parse(parsed.data) as { player_id?: string; event_types?: string[] };
          if (payload.player_id) {
            emitEvent({
              type: 'connected',
              player_id: payload.player_id,
              event_types: Array.isArray(payload.event_types) ? payload.event_types : undefined,
            });
          }
        } catch {
          // ignore malformed connected payload
        }
      }
    });

    return remaining;
  }

  function clearBuffer() {
    eventBuffer.splice(0, eventBuffer.length);
  }

  function getEventBuffer() {
    return [...eventBuffer];
  }

  function getStatus() {
    return status;
  }

  function setServerUrl(nextServerUrl: string) {
    serverUrl = nextServerUrl;
  }

  function parseSseBlock(block: string): { eventType: string; data: string } {
    let eventType = 'message';
    let data = '';

    block.split('\n').forEach((line) => {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data += line.slice(5).trim();
      }
    });

    return { eventType, data };
  }

  return {
    clearBuffer,
    getEventBuffer,
    getStatus,
    setServerUrl,
    start,
    stop,
    subscribe,
    subscribeStatus,
  };
}

export type SseClient = ReturnType<typeof createSseClient>;
