import path from 'node:path';

export interface GatewayConfig {
  port: number;
  dataRoot: string;
  bootstrapEnvFile?: string;
}

export function resolveGatewayConfig(): GatewayConfig {
  return {
    port: Number(process.env.SW_AGENT_GATEWAY_PORT ?? 18180),
    dataRoot: path.resolve(process.env.SW_AGENT_GATEWAY_DATA_DIR ?? './data'),
    bootstrapEnvFile: path.resolve(process.env.SW_AGENT_GATEWAY_ENV_FILE ?? '../.env'),
  };
}
