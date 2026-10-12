import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from './config.js';
import { CoolifyClient } from './coolify/client.js';
import { registerTools } from './tools.js';

export function createMcpServer(
  config: AppConfig,
  transport?: typeof fetch,
): McpServer {
  const server = new McpServer({
    name: 'coolify-mcp',
    version: '0.1.0',
  });

  const client = new CoolifyClient(config, transport);
  registerTools(server, client, config);

  return server;
}
