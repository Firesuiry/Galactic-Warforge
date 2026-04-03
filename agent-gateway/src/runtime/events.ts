export interface GatewayEvent {
  agentId: string;
  type: string;
  payload: unknown;
}

type Listener = (event: GatewayEvent) => void;

export function createEventBus() {
  const listeners = new Map<string, Set<Listener>>();

  return {
    emit(event: GatewayEvent) {
      listeners.get(event.agentId)?.forEach((listener) => listener(event));
    },
    subscribe(agentId: string, listener: Listener) {
      const bucket = listeners.get(agentId) ?? new Set<Listener>();
      bucket.add(listener);
      listeners.set(agentId, bucket);
      return () => {
        bucket.delete(listener);
        if (bucket.size === 0) {
          listeners.delete(agentId);
        }
      };
    },
  };
}
