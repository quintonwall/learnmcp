import type { Matcher, LeafMatcherT } from "./matchers.js";
import { isComposite } from "./matchers.js";
import type { MatchContext } from "./context.js";
import type { SignalKind } from "./signals.js";
import { matchesGlob } from "./glob.js";

/** A subjective check the engine must resolve externally (via an LLM) then re-evaluate. */
export interface JudgeRequest {
  key: string;
  rubric: string;
  confidence_gte: number;
  files: Array<{ path: string; content?: string }>;
}

export interface EvalResult {
  matched: boolean;
  /** llm_judge matchers not yet resolved; empty when detection is fully deterministic. */
  pending: JudgeRequest[];
}

const YES: EvalResult = { matched: true, pending: [] };
const NO: EvalResult = { matched: false, pending: [] };

/** Stable key for caching/looking-up an llm_judge verdict. */
export function judgeKey(m: Extract<LeafMatcherT, { type: "llm_judge" }>): string {
  return `judge:${m.over.file ?? "*"}:${m.rubric}`;
}

/**
 * Evaluate a matcher against accumulated session state. Pure and synchronous:
 * subjective (`llm_judge`) checks that aren't yet resolved surface as `pending`
 * rather than blocking, so the engine owns the async LLM call.
 */
export function evaluateMatcher(m: Matcher, ctx: MatchContext): EvalResult {
  if (isComposite(m)) {
    if ("allOf" in m) return combine(m.allOf, ctx, "all");
    if ("anyOf" in m) return combine(m.anyOf, ctx, "any");
    const inner = evaluateMatcher(m.not, ctx);
    return { matched: !inner.matched, pending: inner.pending };
  }
  return evaluateLeaf(m, ctx);
}

function combine(ms: Matcher[], ctx: MatchContext, mode: "all" | "any"): EvalResult {
  const results = ms.map((x) => evaluateMatcher(x, ctx));
  const pending = results.flatMap((r) => r.pending);
  const matched =
    mode === "all"
      ? results.every((r) => r.matched)
      : results.some((r) => r.matched);
  return { matched, pending };
}

function evaluateLeaf(m: LeafMatcherT, ctx: MatchContext): EvalResult {
  switch (m.type) {
    case "bash": {
      const re = safeRegExp(m.matches);
      if (!re) return NO;
      const hits = ctx.bashCommands.filter((c) => re.test(c)).length;
      return bool(hits >= (m.gte ?? 1));
    }
    case "file": {
      const candidates = [...ctx.files.entries()].filter(([p]) =>
        matchesGlob(p, m.path),
      );
      if (candidates.length === 0) return bool(m.exists === false);
      if (m.exists === false) return NO; // wanted absent, but found
      if (m.contains) {
        // multiline: `^`/`$` anchor to lines, so `^\.env` matches a .gitignore entry
        const re = safeRegExp(m.contains, "m");
        if (!re) return NO;
        return bool(
          candidates.some(([, f]) => f.content != null && re.test(f.content)),
        );
      }
      return YES; // exists (default) and present
    }
    case "dependency":
      return bool(
        ctx.dependencies.some(
          (d) => d.name === m.name && (!m.manifest || d.manifest === m.manifest),
        ),
      );
    case "mcp":
      return bool(ctx.mcpServers.has(m.server));
    case "mcp_tool":
      return bool((ctx.mcpToolCalls.get(`${m.server}:${m.tool}`) ?? 0) >= m.gte);
    case "env": {
      const entry = ctx.env.get(m.key);
      if (m.absent_from === "git") return bool(!!entry && entry.inGit !== true);
      if (m.present === false) return bool(!entry);
      return bool(!!entry);
    }
    case "skill":
      if (m.name) return bool(ctx.skills.has(m.name));
      return bool(m.exists === false ? ctx.skills.size === 0 : ctx.skills.size > 0);
    case "count":
      return bool((ctx.signalCounts.get(m.of as SignalKind) ?? 0) >= m.gte);
    case "llm_judge": {
      const key = judgeKey(m);
      const verdict = ctx.judgements.get(key);
      if (verdict) return bool(verdict.confidence >= m.confidence_gte);
      // Not yet judged: surface a request with the candidate files, don't match yet.
      const files = m.over.file
        ? [...ctx.files.entries()]
            .filter(([p]) => matchesGlob(p, m.over.file!))
            .map(([path, f]) => ({ path, content: f.content }))
        : [];
      // A file selector that matches nothing has nothing to judge yet — not pending.
      if (m.over.file && files.length === 0) return NO;
      return {
        matched: false,
        pending: [{ key, rubric: m.rubric, confidence_gte: m.confidence_gte, files }],
      };
    }
  }
}

function bool(b: boolean): EvalResult {
  return b ? YES : NO;
}

function safeRegExp(src: string, flags?: string): RegExp | null {
  try {
    return new RegExp(src, flags);
  } catch {
    return null;
  }
}
