#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Signal } from "@learnmcp/schema";
import { buildRuntime, userCartridgesDir, type Runtime } from "./config.js";
import { eventToSignals, type HookEvent } from "./hookAdapter.js";
import { scanProject } from "./scanner.js";
import { generateCartridge } from "./generate.js";
import { httpFetchText, createAnthropicComplete } from "./generate-anthropic.js";
import type { RecordResult } from "./service.js";

/**
 * learnmcp hook CLI. Invoked by the Claude Code plugin's hooks (see packages/plugin).
 * Reads a hook payload on stdin, records the resulting signals into the shared store,
 * and prints the appropriate hook output JSON.
 *
 * Subcommands: session-start | post-tool-use | record <signal-json> | scan <dir>
 * stdout carries hook output JSON; diagnostics go to stderr.
 */

const TEXT_EXTS = new Set([".md", ".yml", ".yaml", ".sql", ".toml", ".txt", ".json", ".env"]);
const TEXT_BASENAMES = new Set([".gitignore", "CODEOWNERS", ".env", "Dockerfile"]);
const MAX_CONTENT = 128 * 1024;

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
}

function enrichFileContent(sig: Signal, cwd?: string): Signal {
  if (sig.kind !== "file" || !cwd) return sig;
  const base = path.basename(sig.path);
  const ext = path.extname(sig.path);
  if (!TEXT_EXTS.has(ext) && !TEXT_BASENAMES.has(base)) return sig;
  try {
    const abs = path.isAbsolute(sig.path) ? sig.path : path.join(cwd, sig.path);
    if (statSync(abs).size <= MAX_CONTENT) return { ...sig, content: readFileSync(abs, "utf8") };
  } catch {
    /* unreadable — leave as-is */
  }
  return sig;
}

function recordSummary(r: RecordResult): string {
  const parts: string[] = [];
  for (const b of r.newBadges) parts.push(`🏅 ${b.name} (+${b.points})`);
  for (const o of r.newObjectives) parts.push(`✅ ${o.title}`);
  parts.push(
    r.rank.next
      ? `${r.rank.rank.name} · ${r.points} pts (${r.rank.pointsToNext} to ${r.rank.next.name})`
      : `${r.rank.rank.name} · ${r.points} pts`,
  );
  return parts.join("  ·  ");
}

async function sessionStart(rt: Runtime, event: HookEvent): Promise<void> {
  const dir = event.cwd || rt.scope;
  for (const sig of scanProject(dir)) rt.service.record(rt.scope, sig);

  const prog = rt.service.progress(rt.scope);
  const next = rt.service.learnNext(rt.scope);
  const tracks = prog.cartridges.map((c) => `${c.id} (${c.completed}/${c.total})`).join(", ");
  const lines = [
    `learnmcp is tracking this project. Rank ${prog.rank.rank.name} · ${prog.points} pts · ${prog.earnedBadges} badges.`,
    tracks ? `Active learning tracks: ${tracks}.` : "No cartridges active yet.",
    next ? `Suggested next: ${next.title} (${next.cartridgeId}) — ${next.why ?? ""}`.trim() : "",
  ].filter(Boolean);

  emit({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join(" ") },
  });
}

async function postToolUse(rt: Runtime, event: HookEvent): Promise<void> {
  const signals = eventToSignals(event).map((s) => enrichFileContent(s, event.cwd));

  // One tool use can emit several signals (e.g. an MCP call = mcp.added + mcp_tool);
  // aggregate the deltas across all of them so nothing earned this action is dropped.
  let last: RecordResult | null = null;
  const badges: RecordResult["newBadges"] = [];
  const objectives: RecordResult["newObjectives"] = [];
  for (const sig of signals) {
    last = rt.service.record(rt.scope, sig);
    badges.push(...last.newBadges);
    objectives.push(...last.newObjectives);
  }

  // Surface only when something was actually earned (never on every action — no nagging),
  // and pair the reward with the next suggestion so the loop closes at completion time.
  if (last && (badges.length || objectives.length)) {
    const next = rt.service.learnNext(rt.scope);
    const suffix = next ? `  ·  Next: ${next.title} (${next.cartridgeId})` : "";
    emit({
      systemMessage: `learnmcp — ${recordSummary({ ...last, newBadges: badges, newObjectives: objectives })}${suffix}`,
    });
  }
}

function emit(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj));
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "session-start" || cmd === "post-tool-use") {
    const raw = await readStdin();
    let event: HookEvent = {};
    try {
      event = raw ? JSON.parse(raw) : {};
    } catch {
      /* tolerate empty/garbage stdin — hooks must never break the session */
    }
    const rt = await buildRuntime({ project: event.cwd });
    try {
      if (cmd === "session-start") await sessionStart(rt, event);
      else await postToolUse(rt, event);
    } finally {
      rt.store.close();
      await rt.registry.close();
    }
    return;
  }

  if (cmd === "record") {
    const parsed = Signal.safeParse(JSON.parse(rest[0] ?? "{}"));
    if (!parsed.success) {
      console.error("[learnmcp] invalid signal:", parsed.error.issues[0]?.message);
      process.exit(1);
    }
    const rt = await buildRuntime();
    const result = rt.service.record(rt.scope, parsed.data);
    console.log(recordSummary(result));
    rt.store.close();
    await rt.registry.close();
    return;
  }

  if (cmd === "scan") {
    const dir = rest[0] || process.cwd();
    const rt = await buildRuntime({ project: dir });
    const signals = scanProject(dir);
    for (const s of signals) rt.service.record(rt.scope, s);
    console.log(`scanned ${signals.length} signals; ${recordSummary(rt.service.recompute(rt.scope))}`);
    rt.store.close();
    await rt.registry.close();
    return;
  }

  if (cmd === "generate") {
    const url = rest[0];
    if (!url) {
      console.error("usage: learnmcp generate <docs-url>");
      process.exit(1);
    }
    const res = await generateCartridge({
      url,
      fetchText: httpFetchText,
      complete: createAnthropicComplete(),
      outDir: userCartridgesDir(),
      repair: true,
    });
    if (!res.ok) {
      console.error(`[learnmcp] generation failed: ${res.error}`);
      process.exit(1);
    }
    console.log(
      `generated "${res.cartridge.id}" (${res.cartridge.objectives.length} objectives, ${res.cartridge.badges.length} badges) → ${res.path}`,
    );
    return;
  }

  console.error(
    "usage: learnmcp <session-start|post-tool-use|record <json>|scan [dir]|generate <url>>",
  );
  process.exit(1);
}

main().catch((err) => {
  // Hooks must fail open — never block the session on a learnmcp error.
  console.error("[learnmcp] cli error:", err);
  process.exit(0);
});
