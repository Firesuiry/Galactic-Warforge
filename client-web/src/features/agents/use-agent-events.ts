import { useEffect } from 'react';

export function useAgentEvents(agentId: string, onEvent: () => void) {
  useEffect(() => {
    if (!agentId || typeof EventSource === 'undefined') {
      return;
    }

    const eventSource = new EventSource(`/agent-api/agents/${agentId}/events`);
    const handleMessage = () => onEvent();

    eventSource.onmessage = handleMessage;
    eventSource.addEventListener('assistant_message', handleMessage);
    eventSource.addEventListener('tool_result', handleMessage);
    eventSource.addEventListener('status', handleMessage);
    eventSource.addEventListener('completed', handleMessage);
    eventSource.addEventListener('error', handleMessage);

    return () => {
      eventSource.close();
    };
  }, [agentId, onEvent]);
}
