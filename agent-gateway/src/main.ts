import { resolveGatewayConfig } from './config.js';
import { createGatewayServer } from './server.js';

const config = resolveGatewayConfig();
const server = await createGatewayServer(config);

console.log(`agent-gateway listening on ${server.url}`);
