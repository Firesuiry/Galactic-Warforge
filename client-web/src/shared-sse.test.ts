import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSseClient } from "@shared/sse";

function sseResponse(body: ReadableStream<Uint8Array>) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** 永不产生数据、只在 abort 时关闭的流，模拟静默半开连接 */
function silentStream(signal?: AbortSignal) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => {
        try {
          controller.close();
        } catch {
          // 已关闭则忽略
        }
      });
    },
  });
}

describe("shared sse client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("忽略服务端心跳注释行，不产生事件", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: connected\ndata: {"player_id":"p1"}\n\n'),
        );
        controller.enqueue(encoder.encode(": ping\n\n: ping\n\n"));
        controller.enqueue(
          encoder.encode(
            'event: game\ndata: {"event_id":"e1","tick":1,"event_type":"tick_completed","visibility_scope":"all","payload":{}}\n\n',
          ),
        );
        controller.close();
      },
    });
    const client = createSseClient({
      serverUrl: "http://localhost:1",
      fetchFn: () => Promise.resolve(sseResponse(stream)),
    });
    const events: string[] = [];
    client.subscribe((event) => events.push(event.type));
    client.start({ playerKey: "key" });
    await vi.advanceTimersByTimeAsync(0);

    expect(events).toEqual(["connected", "game"]);
    client.stop();
  });

  it("超过心跳阈值未收到任何字节时主动断开并重连", async () => {
    let calls = 0;
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => {
      calls += 1;
      return Promise.resolve(sseResponse(silentStream(init?.signal ?? undefined)));
    });
    const client = createSseClient({
      serverUrl: "http://localhost:1",
      fetchFn: fetchMock as unknown as typeof fetch,
      heartbeatTimeoutMs: 300,
      initialRetryDelayMs: 100,
    });
    const statuses: string[] = [];
    client.subscribeStatus((status) => statuses.push(status));
    client.start({ playerKey: "key" });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);

    // 看门狗判定连接死亡 → abort → 进入重连
    await vi.advanceTimersByTimeAsync(400);
    expect(statuses).toContain("reconnecting");

    // 退避后发起第二次连接
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toBeGreaterThanOrEqual(2);
    client.stop();
  });

  it("持续有心跳时看门狗不会误杀连接", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => {
      const signal = init?.signal ?? undefined;
      let timer: ReturnType<typeof setInterval> | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          timer = setInterval(() => {
            controller.enqueue(encoder.encode(": ping\n\n"));
          }, 100);
          signal?.addEventListener("abort", () => {
            if (timer) clearInterval(timer);
          });
        },
        cancel() {
          if (timer) clearInterval(timer);
        },
      });
      return Promise.resolve(sseResponse(stream));
    });
    const client = createSseClient({
      serverUrl: "http://localhost:1",
      fetchFn: fetchMock as unknown as typeof fetch,
      heartbeatTimeoutMs: 300,
      initialRetryDelayMs: 100,
    });
    client.start({ playerKey: "key" });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getStatus()).toBe("connected");
    client.stop();
  });
});
