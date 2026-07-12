import type { Signal, SignalKind } from "./signals.js";

/**
 * The engine evaluates matchers against accumulated session state, not a single
 * signal — `count`/`gte`/`mcp_tool` need history. MatchContext is that aggregated view.
 * `judgements` holds externally-resolved llm_judge verdicts, keyed by a stable matcher
 * key, so the evaluator stays pure and synchronous.
 */
export interface MatchContext {
  bashCommands: string[];
  files: Map<string, { content?: string; seen: boolean }>;
  dependencies: Array<{ name: string; manifest: string }>;
  mcpServers: Set<string>;
  mcpToolCalls: Map<string, number>; // key: `${server}:${tool}`
  skills: Set<string>;
  env: Map<string, { inGit?: boolean }>;
  signalCounts: Map<SignalKind, number>;
  judgements: Map<string, { confidence: number }>;
}

export function emptyContext(): MatchContext {
  return {
    bashCommands: [],
    files: new Map(),
    dependencies: [],
    mcpServers: new Set(),
    mcpToolCalls: new Map(),
    skills: new Set(),
    env: new Map(),
    signalCounts: new Map(),
    judgements: new Map(),
  };
}

/** Fold a single signal into the context (mutates and returns it). */
export function applySignal(ctx: MatchContext, s: Signal): MatchContext {
  ctx.signalCounts.set(s.kind, (ctx.signalCounts.get(s.kind) ?? 0) + 1);
  switch (s.kind) {
    case "bash":
      ctx.bashCommands.push(s.command);
      break;
    case "file": {
      const prev = ctx.files.get(s.path);
      ctx.files.set(s.path, {
        content: s.content ?? prev?.content,
        seen: true,
      });
      break;
    }
    case "dependency":
      ctx.dependencies.push({ name: s.name, manifest: s.manifest });
      break;
    case "mcp.added":
      ctx.mcpServers.add(s.server);
      break;
    case "mcp_tool": {
      const key = `${s.server}:${s.tool}`;
      ctx.mcpToolCalls.set(key, (ctx.mcpToolCalls.get(key) ?? 0) + 1);
      break;
    }
    case "skill":
      ctx.skills.add(s.name);
      break;
    case "env":
      ctx.env.set(s.key, { inGit: s.inGit });
      break;
  }
  return ctx;
}

export function buildContext(signals: Signal[]): MatchContext {
  return signals.reduce(applySignal, emptyContext());
}
