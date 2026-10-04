import { useEffect } from 'react';

import type {
  ConversationMessage,
  ConversationTurn,
} from '@shared/agent-gateway';

export interface ConversationStreamEvent {
  type: 'message' | 'turn.updated' | 'turn.completed' | 'turn.failed';
  payload: ConversationMessage | ConversationTurn;
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
        payload: parseEventPayload<ConversationMessage>(event),
      });
    };
    const handleTurnUpdated = (event: Event) => {
      onEvent({
        type: 'turn.updated',
        payload: parseEventPayload<ConversationTurn>(event as MessageEvent),
      });
    };
    const handleTurnCompleted = (event: Event) => {
      onEvent({
        type: 'turn.completed',
        payload: parseEventPayload<ConversationTurn>(event as MessageEvent),
      });
    };
    const handleTurnFailed = (event: Event) => {
      onEvent({
        type: 'turn.failed',
        payload: parseEventPayload<ConversationTurn>(event as MessageEvent),
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
