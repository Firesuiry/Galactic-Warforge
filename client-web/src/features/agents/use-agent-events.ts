import { useEffect } from 'react';

export function useConversationEvents(conversationId: string, onEvent: () => void) {
  useEffect(() => {
    if (!conversationId || typeof EventSource === 'undefined') {
      return;
    }

    const eventSource = new EventSource(`/agent-api/conversations/${conversationId}/events`);
    const handleMessage = () => onEvent();

    eventSource.onmessage = handleMessage;
    eventSource.addEventListener('message', handleMessage);

    return () => {
      eventSource.close();
    };
  }, [conversationId, onEvent]);
}
