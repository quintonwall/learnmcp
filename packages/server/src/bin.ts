#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildRuntime } from "./config.js";
import { createMcpServer } from "./mcp.js";

/**
 * learnmcp MCP server entrypoint (stdio). See config.ts for env vars.
 * IMPORTANT: stdout is the MCP channel — all logging goes to stderr.
 */
async function main(): Promise<void> {
  const { registry, store, scope, dbPath } = await buildRuntime({ watch: true });

  const server = createMcpServer({ registry, store, defaultScope: scope });
  await server.connect(new StdioServerTransport());

  console.error(
    `[learnmcp] ready — ${registry.size()} cartridges, scope=${scope}, db=${dbPath}`,
  );

  const shutdown = async () => {
    await registry.close();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[learnmcp] fatal:", err);
  process.exit(1);
});
