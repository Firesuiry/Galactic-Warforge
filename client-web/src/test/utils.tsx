import type { PropsWithChildren } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AppRoutes } from '@/app/routes';

export function renderApp(initialEntries: string[] = ['/']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return render(<AppRoutes />, { wrapper: Wrapper });
}

export function jsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
    },
    status: 200,
    ...init,
  });
}

interface SseBlock {
  event: string;
  data: unknown;
}

export function sseResponse(blocks: SseBlock[], signal?: AbortSignal) {
  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      blocks.forEach((block) => {
        controller.enqueue(encoder.encode(
          `event: ${block.event}\ndata: ${JSON.stringify(block.data)}\n\n`,
        ));
      });
      signal?.addEventListener('abort', () => {
        controller.close();
      }, { once: true });
    },
    cancel() {
      controllerRef = null;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
    },
    status: 200,
  });
}
