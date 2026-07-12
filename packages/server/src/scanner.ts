import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Signal } from "@learnmcp/schema";

/**
 * One-shot project introspection → signals. This is the Codex fallback for passive
 * monitoring (Codex has no hook system) and the SessionStart bootstrap for Claude Code:
 * it reads the project's current state so cartridges can activate and objectives that
 * are already satisfied get credited immediately.
 *
 * All signals it emits are idempotent kinds (file / dependency / mcp.added / skill), so
 * re-scanning is safe (see SqliteStore.recordSignal).
 */

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
]);

/** Read content for these — small text files that content-matchers care about. */
const TEXT_EXTS = new Set([".md", ".yml", ".yaml", ".sql", ".toml", ".txt", ".json", ".env"]);
const TEXT_BASENAMES = new Set([".gitignore", "CODEOWNERS", ".env", "Dockerfile"]);
const MAX_CONTENT_BYTES = 128 * 1024;

export interface ScanOptions {
  maxDepth?: number;
  now?: () => number;
}

export function scanProject(root: string, opts: ScanOptions = {}): Signal[] {
  const maxDepth = opts.maxDepth ?? 4;
  const signals: Signal[] = [];
  const files: string[] = [];

  walk(root, root, 0, maxDepth, files);

  for (const rel of files) {
    const abs = path.join(root, rel);
    const base = path.basename(rel);
    const ext = path.extname(rel);
    const wantContent = TEXT_EXTS.has(ext) || TEXT_BASENAMES.has(base);
    let content: string | undefined;
    if (wantContent) {
      try {
        if (statSync(abs).size <= MAX_CONTENT_BYTES) content = readFileSync(abs, "utf8");
      } catch {
        /* unreadable — emit path only */
      }
    }
    signals.push({ kind: "file", path: rel, event: "exists", ...(content ? { content } : {}) });
  }

  signals.push(...dependencySignals(root, files));
  signals.push(...mcpSignals(root, files));
  signals.push(...skillSignals(files));

  return signals;
}

function walk(root: string, dir: string, depth: number, maxDepth: number, out: string[]): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".git") && e.name !== ".gitignore") {
      if (e.isDirectory()) continue;
    }
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name) || depth >= maxDepth) continue;
      walk(root, abs, depth + 1, maxDepth, out);
    } else if (e.isFile()) {
      out.push(path.relative(root, abs));
    }
  }
}

function dependencySignals(root: string, files: string[]): Signal[] {
  const out: Signal[] = [];
  for (const rel of files.filter((f) => path.basename(f) === "package.json")) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(root, rel), "utf8"));
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const name of Object.keys(deps)) {
        out.push({ kind: "dependency", name, manifest: rel });
      }
    } catch {
      /* ignore malformed package.json */
    }
  }
  return out;
}

/** MCP servers configured in common project-level config files. */
function mcpSignals(root: string, files: string[]): Signal[] {
  const out: Signal[] = [];
  const configs = files.filter((f) =>
    [".mcp.json", "mcp.json"].includes(path.basename(f)),
  );
  for (const rel of configs) {
    try {
      const json = JSON.parse(readFileSync(path.join(root, rel), "utf8"));
      const servers = json.mcpServers ?? json.servers ?? {};
      for (const server of Object.keys(servers)) out.push({ kind: "mcp.added", server });
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Claude Code skills live under .claude/skills/<name>/. */
function skillSignals(files: string[]): Signal[] {
  const names = new Set<string>();
  for (const rel of files) {
    const parts = rel.split(path.sep);
    const i = parts.indexOf("skills");
    if (i > 0 && parts[i - 1] === ".claude" && parts[i + 1]) names.add(parts[i + 1]);
  }
  return [...names].map((name) => ({ kind: "skill", name }));
}
