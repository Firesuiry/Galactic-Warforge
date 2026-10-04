import { DEFAULT_SERVER_URL, DEFAULT_SSE_BUFFER_SIZE } from '@gw/shared/config';

export const SERVER_URL = process.env.SW_SERVER ?? DEFAULT_SERVER_URL;
export const AGENT_GATEWAY_URL = process.env.SW_AGENT_GATEWAY ?? 'http://127.0.0.1:18180';
export function getAgentGatewayUrl() {
  return process.env.SW_AGENT_GATEWAY ?? AGENT_GATEWAY_URL;
}
export const SSE_BUFFER_SIZE = DEFAULT_SSE_BUFFER_SIZE;
export const SSE_VERBOSE = process.env.SW_SSE_VERBOSE === '1';
