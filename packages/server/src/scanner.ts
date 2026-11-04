import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

/** `.env`, `.env.local`, `.env.production`, `prod.env` — files that hold secrets. */
export function isEnvFile(rel: string): boolean {
  // Split on both separators and ignore case: a Windows client sends `config\.env.local`,
  // which path.basename on a POSIX server would treat as one long file name.
  const base = (rel.split(/[\\/]/).pop() ?? "").toLowerCase();
  return base === ".env" || base.startsWith(".env.") || base.endsWith(".env");
}

/**
 * The variable names in a dotenv file, never the values. Content of these files must not
 * leave the machine: they hold credentials, and nothing downstream needs more than "this
 * key is set" (the `env` matcher).
 */
export function envKeyNames(text: string): string[] {
  const keys = new Set<string>();
  // True when a line has an odd number of unescaped quotes of some kind, i.e. it may open a
  // value that runs onto later lines (a private key, say). Parsing dotenv's quoting rules
  // line by line is a losing game — `KEY=`, `KEY:`, dotted names, escapes — and a missed
  // case turns a line of secret (padded base64 like `YWJjZA==`) into a "key name". So when
  // a line is ambiguous, stop reading: keys already seen are safe, later ones are dropped.
  const mayOpenMultiline = (line: string): boolean => {
    // Parsers disagree about what a backslash before a quote means, so don't guess: any
    // such line is ambiguous. Without one, escapes can't matter and plain parity is exact.
    if (/\\["'`]/.test(line)) return true;
    for (const q of ['"', "'", "`"]) {
      if (line.split(q).length % 2 === 0) return true;
    }
    return false;
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    // Upper-snake names only: what real variables look like.
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*[=:]/);
    if (m) keys.add(m[1]!);
    if (mayOpenMultiline(line)) break;
  }
  return [...keys];
}

/**
 * Applied to every signal the server ingests, whatever client sent it: an older plugin
 * still ships `.env` content, and the server must not store it. The content is replaced by
 * the key names it holds, which is all the `env` matcher needs.
 */
export function scrubSecrets(signal: Signal): Signal[] {
  if (signal.kind !== "file" || !isEnvFile(signal.path) || signal.content === undefined) return [signal];
  const { content, ...bare } = signal;
  const project = signal.project ? { project: signal.project } : {};
  return [bare, ...envKeyNames(content).map((key): Signal => ({ kind: "env", key, ...project }))];
}

export interface ScanOptions {
  maxDepth?: number;
  now?: () => number;
}

export function scanProject(root: string, opts: ScanOptions = {}): Signal[] {
  const maxDepth = opts.maxDepth ?? 4;
  const signals: Signal[] = [];
  const files: string[] = [];

  walk(root, root, 0, maxDepth, files);

  // `.git` is never walked, so report an existing repo explicitly (looking upward: a
  // subfolder of a repo is under version control too; `.git` is a file in worktrees).
  if (insideGitRepo(root)) signals.push({ kind: "file", path: ".git", event: "exists" });

  for (const rel of files) {
    const abs = path.join(root, rel);
    const base = path.basename(rel);
    const ext = path.extname(rel);
    if (isEnvFile(rel)) {
      // Names only: report which keys are set, and the file's existence, but no content.
      try {
        if (statSync(abs).size <= MAX_CONTENT_BYTES) {
          for (const key of envKeyNames(readFileSync(abs, "utf8"))) signals.push({ kind: "env", key });
        }
      } catch {
        /* unreadable — emit path only */
      }
      signals.push({ kind: "file", path: rel, event: "exists" });
      continue;
    }
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

function insideGitRepo(root: string): boolean {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, ".git"))) return true;
    if (path.dirname(dir) === dir) return false;
  }
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

/**
 * MCP servers that Claude Code provides but the project never mentions: those bundled by
 * installed plugins, plus user-level config. Without this a plugin-supplied server (the
 * Postman plugin, say) is invisible until the model happens to call one of its tools,
 * because nothing in the repo references it.
 *
 * `home` is injectable so this is testable against a fixture tree.
 */
export function claudeEnvSignals(home: string): Signal[] {
  const servers = new Set<string>();

  const addFrom = (file: string): void => {
    try {
      const json = JSON.parse(readFileSync(file, "utf8"));
      for (const key of Object.keys(json.mcpServers ?? json.servers ?? {})) servers.add(key);
    } catch {
      /* missing or malformed — this is best-effort enrichment, never fatal */
    }
  };

  // Installed plugins: each install path may ship its own .mcp.json.
  try {
    const registry = JSON.parse(
      readFileSync(path.join(home, ".claude/plugins/installed_plugins.json"), "utf8"),
    );
    for (const installs of Object.values(registry.plugins ?? {})) {
      for (const install of installs as Array<{ installPath?: string }>) {
        if (install?.installPath) addFrom(path.join(install.installPath, ".mcp.json"));
      }
    }
  } catch {
    /* no plugins installed */
  }

  // User-level servers configured directly.
  addFrom(path.join(home, ".claude/settings.json"));
  addFrom(path.join(home, ".claude.json"));

  return [...servers].map((server) => ({ kind: "mcp.added", server }));
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
