#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createMcpServer } from './server.js';
import { redactSecrets } from './coolify/redaction.js';

async function main(): Promise<void> {
  const secrets = process.env.COOLIFY_TOKEN ? [process.env.COOLIFY_TOKEN] : [];

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const safeMessage = redactSecrets(rawMessage, secrets);
    console.error(`Configuration error: ${safeMessage}`);
    process.exit(1);
  }

  try {
    const server = createMcpServer(config);
    const transport = new StdioServerTransport();

    const cleanup = async () => {
      try {
        await server.close();
      } catch {
        // ignore errors during shutdown
      }
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.stdin.on('close', cleanup);

    await server.connect(transport);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const safeMessage = redactSecrets(rawMessage, secrets);
    console.error(`Server error: ${safeMessage}`);
    process.exit(1);
  }
}

main().catch((error) => {
  const secrets = process.env.COOLIFY_TOKEN ? [process.env.COOLIFY_TOKEN] : [];
  const rawMessage = error instanceof Error ? error.message : String(error);
  const safeMessage = redactSecrets(rawMessage, secrets);
  console.error(`Fatal error: ${safeMessage}`);
  process.exit(1);
});
