import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateCartridge, type Cartridge } from "@learnmcp/schema";

/**
 * Dynamic cartridge generation: point at a docs URL, get a validated cartridge.
 *
 * The pipeline's external boundaries — fetching docs and calling an LLM — are
 * injected, so the core (crawl planning, prompt building, response parsing,
 * schema validation, file writing) is pure and unit-testable. Real implementations
 * live in generate-anthropic.ts.
 */

export type FetchText = (url: string) => Promise<string>;
export type Complete = (prompt: string) => Promise<string>;

export interface GenerateOptions {
  url: string;
  fetchText: FetchText;
  complete: Complete;
  /** Directory to write the generated cartridge into (hot-loaded by the registry). */
  outDir?: string;
  /** Retry once with error feedback if the first attempt fails validation. */
  repair?: boolean;
}

export type GenerateResult =
  | { ok: true; cartridge: Cartridge; path?: string }
  | { ok: false; error: string; raw?: string };

/** The matcher vocabulary the model may use — kept in sync with @learnmcp/schema. */
const MATCHER_REFERENCE = `
Allowed matcher types (a cartridge may ONLY use these — never invent new ones, never emit code):
- { "type": "bash", "matches": "<regex>", "gte": <n?> }              a shell command matched a regex
- { "type": "file", "path": "<glob>", "exists": <bool?>, "contains": "<regex?>" }
- { "type": "dependency", "name": "<pkg>", "manifest": "<file?>" }
- { "type": "mcp", "server": "<name>" }                              an MCP server was added
- { "type": "mcp_tool", "server": "<name>", "tool": "<tool>", "gte": <n?> }
- { "type": "env", "key": "<VAR>", "absent_from": "git"? , "present": <bool?> }
- { "type": "skill", "name": "<name?>", "exists": <bool?> }
- { "type": "count", "of": "<signal-kind>", "gte": <n> }             e.g. of "mcp.added"
- { "type": "llm_judge", "over": { "file": "<glob?>" }, "rubric": "<question>", "confidence_gte": <0..1?> }
- composites: { "allOf": [<matcher>...] } | { "anyOf": [<matcher>...] } | { "not": <matcher> }
Globs support **, * and {a,b}. If a best practice is subjective, use llm_judge; if it can't be
expressed with any matcher, drop it — never invent a matcher type.`;

export function buildGenerationPrompt(url: string, docs: string): string {
  return `You are authoring a "learnmcp" cartridge — a JSON document that teaches best practices for a
developer tool by rewarding actions with badges as a developer works.

Generate a cartridge for the product documented at: ${url}

Return ONLY a single JSON object (no prose, no markdown fences) with this exact shape:
{
  "id": "<kebab-case id, e.g. 'vercel'>",
  "version": "1.0.0",
  "provider": { "name": "<Product>", "homepage": "<url>", "icon": "<one emoji>" },
  "detect": [ <matcher>... ],          // when is this cartridge relevant to a project?
  "objectives": [ { "id","title","docs"?,"why"?,"criteria": <matcher>, "badge"?: "<badge-id>" }... ],
  "bestPractices": [ <same shape as objectives, recommended: true> ],
  "badges": [ { "id","name","tier"?: "bronze|silver|gold|platinum","description"?, "criteria"?: <matcher> }... ]
}

Rules:
- 4-6 objectives covering the core workflow, ordered from first-steps to advanced.
- 2-3 bestPractices, including at least one security/hygiene item (e.g. keep API keys out of git via an "env" matcher with "absent_from": "git").
- Every objective's "badge" must reference a badge id you define in "badges".
- Include one gold "count"- or high-"gte"-based badge for sustained use.
- Prefer concrete, detectable criteria (mcp_tool / file / dependency / bash). Use llm_judge only for genuinely subjective quality.
- Deep-link "docs" to the most relevant page you can infer.
${MATCHER_REFERENCE}

Documentation extract:
"""
${docs.slice(0, 40000)}
"""`;
}

/** Pull a JSON object out of an LLM response that may be fenced or prefixed. */
export function extractJson(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body.trim();
}

async function gatherDocs(url: string, fetchText: FetchText): Promise<string> {
  const parts: string[] = [];
  parts.push(await fetchText(url));
  // Best-effort: an llms.txt often summarizes a docs site far better than the homepage.
  try {
    const origin = new URL(url).origin;
    const llms = await fetchText(`${origin}/llms.txt`);
    if (llms && llms.length > 40) parts.push(`\n\n--- llms.txt ---\n${llms}`);
  } catch {
    /* no llms.txt — fine */
  }
  return parts.join("\n");
}

export async function generateCartridge(opts: GenerateOptions): Promise<GenerateResult> {
  let docs: string;
  try {
    docs = await gatherDocs(opts.url, opts.fetchText);
  } catch (err) {
    return { ok: false, error: `failed to fetch ${opts.url}: ${(err as Error).message}` };
  }
  if (!docs.trim()) return { ok: false, error: `no readable content at ${opts.url}` };

  const attempt = async (prompt: string): Promise<GenerateResult> => {
    const raw = await opts.complete(prompt);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch (err) {
      return { ok: false, error: `model did not return valid JSON: ${(err as Error).message}`, raw };
    }
    parsed.trust = "generated"; // never auto-trust a generated cartridge
    const result = validateCartridge(parsed);
    if (!result.ok) return { ok: false, error: result.error, raw };

    let outPath: string | undefined;
    if (opts.outDir) {
      mkdirSync(opts.outDir, { recursive: true });
      outPath = path.join(opts.outDir, `${result.cartridge.id}.json`);
      writeFileSync(outPath, JSON.stringify(result.cartridge, null, 2));
    }
    return { ok: true, cartridge: result.cartridge, path: outPath };
  };

  const first = await attempt(buildGenerationPrompt(opts.url, docs));
  if (first.ok || !opts.repair) return first;

  // One repair pass: hand the model its own output plus the validation error.
  const repairPrompt =
    buildGenerationPrompt(opts.url, docs) +
    `\n\nYour previous attempt was invalid: ${first.error}\n` +
    (first.raw ? `It produced:\n${first.raw.slice(0, 4000)}\n` : "") +
    `Return corrected JSON only.`;
  return attempt(repairPrompt);
}
