import { useEffect } from 'react';

import type {
  ConversationMessageView,
  ConversationTurnView,
} from './types';

export interface ConversationStreamEvent {
  type: 'message' | 'turn.updated' | 'turn.completed' | 'turn.failed';
  payload: ConversationMessageView | ConversationTurnView;
}

function parseEventPayload<T>(event: MessageEvent) {
  return JSON.parse(event.data) as T;
}

export function useConversationEvents(
  conversationId: string,
  onEvent: (event: ConversationStreamEvent) => void,
) {
  useEffect(() => {
    if (!conversationId || typeof EventSource === 'undefined') {
      return;
    }

    const eventSource = new EventSource(`/agent-api/conversations/${conversationId}/events`);
    const handleMessage = (event: MessageEvent) => {
      onEvent({
        type: 'message',
        payload: parseEventPayload<ConversationMessageView>(event),
      });
    };
    const handleTurnUpdated = (event: Event) => {
      onEvent({
        type: 'turn.updated',
        payload: parseEventPayload<ConversationTurnView>(event as MessageEvent),
      });
    };
    const handleTurnCompleted = (event: Event) => {
      onEvent({
        type: 'turn.completed',
        payload: parseEventPayload<ConversationTurnView>(event as MessageEvent),
      });
    };
    const handleTurnFailed = (event: Event) => {
      onEvent({
        type: 'turn.failed',
        payload: parseEventPayload<ConversationTurnView>(event as MessageEvent),
      });
    };

    eventSource.onmessage = handleMessage;
    eventSource.addEventListener('message', handleMessage);
    eventSource.addEventListener('turn.updated', handleTurnUpdated);
    eventSource.addEventListener('turn.completed', handleTurnCompleted);
    eventSource.addEventListener('turn.failed', handleTurnFailed);

    return () => {
      eventSource.close();
    };
  }, [conversationId, onEvent]);
}
