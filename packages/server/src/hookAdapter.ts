import path from "node:path";
import type { Signal } from "@learnmcp/schema";

/**
 * Translates a Claude Code hook payload into learnmcp signals. Pure and dependency-free
 * so it's unit-testable; the CLI (cli.ts) enriches file signals with content and writes
 * the results to the store.
 *
 * Only the fields we use are typed; hook payloads carry more.
 */
export interface HookEvent {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  source?: string;
}

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** Parse an MCP tool name `mcp__<server>__<tool>` (server has no `__`, tool may). */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith("mcp__")) return null;
  const parts = name.split("__");
  if (parts.length < 3) return null;
  return { server: parts[1], tool: parts.slice(2).join("__") };
}

function relPath(filePath: string, cwd?: string): string {
  if (cwd && path.isAbsolute(filePath)) {
    const rel = path.relative(cwd, filePath);
    if (!rel.startsWith("..")) return rel;
  }
  return filePath;
}

/**
 * Map a tool-use hook event to signals. A single tool use can yield several signals
 * (e.g. an MCP tool call implies the server is present *and* was invoked).
 */
export function eventToSignals(event: HookEvent): Signal[] {
  const tool = event.tool_name;
  if (!tool) return [];
  const input = event.tool_input ?? {};

  if (tool === "Bash") {
    const command = input.command;
    return typeof command === "string" && command.trim()
      ? [{ kind: "bash", command }]
      : [];
  }

  if (FILE_TOOLS.has(tool)) {
    const fp = (input.file_path ?? input.notebook_path) as string | undefined;
    return typeof fp === "string" && fp
      ? [{ kind: "file", path: relPath(fp, event.cwd), event: "change" }]
      : [];
  }

  const mcp = parseMcpToolName(tool);
  if (mcp) {
    return [
      { kind: "mcp.added", server: mcp.server },
      { kind: "mcp_tool", server: mcp.server, tool: mcp.tool },
    ];
  }

  return [];
}
