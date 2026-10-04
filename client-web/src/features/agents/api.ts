import { createAgentGatewayClient } from '@shared/agent-gateway';

/** 经 vite 代理（/agent-api → agent-gateway）访问网关。 */
export const agentGateway = createAgentGatewayClient({ baseUrl: '/agent-api' });
