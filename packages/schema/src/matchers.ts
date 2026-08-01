import { z } from "zod";

/**
 * A matcher is the declarative predicate a cartridge author writes to say
 * "this best practice or action was performed." The engine — never the cartridge —
 * evaluates it against the session's signal stream. Matchers contain NO executable
 * code, which is what makes untrusted (community / generated) cartridges safe to run.
 *
 * The vocabulary below is the real product surface: when an author needs a detection
 * the primitives can't express, add a new first-party matcher type here — never a
 * code escape hatch. `llm_judge` is the escape valve for subjective practices.
 */

// --- Leaf matchers (discriminated by `type`) ------------------------------------

/** A shell command matched a regex (optionally at least `gte` times). */
export const BashMatcher = z.object({
  type: z.literal("bash"),
  matches: z.string(), // regex, tested against each command
  gte: z.number().int().positive().optional(),
});

/** A file was created/edited, exists, and/or its contents match a regex. */
export const FileMatcher = z.object({
  type: z.literal("file"),
  path: z.string(), // glob: supports ** , * and {a,b} alternation
  exists: z.boolean().optional(),
  contains: z.string().optional(), // regex tested against file contents
});

/** A dependency appeared in a manifest (package.json, requirements.txt, ...). */
export const DependencyMatcher = z.object({
  type: z.literal("dependency"),
  name: z.string(),
  manifest: z.string().optional(), // defaults to any manifest
});

/** An MCP server was added to the session/config. */
export const McpMatcher = z.object({
  type: z.literal("mcp"),
  server: z.string(),
});

/**
 * An MCP tool was invoked at least `gte` times (default 1).
 *
 * `tool` is matched exactly first, then as an anchored regex — so `createIssue` behaves as
 * before, while `create_?[Ii]ssue` covers a server whose exact spelling you couldn't
 * confirm. Servers behind OAuth can't be introspected when authoring a cartridge, and a
 * name guessed slightly wrong fails silently forever.
 */
export const McpToolMatcher = z.object({
  type: z.literal("mcp_tool"),
  server: z.string(),
  tool: z.string(),
  gte: z.number().int().positive().default(1),
});

/** An env/config key is present (or provably absent from a source like git). */
export const EnvMatcher = z.object({
  type: z.literal("env"),
  key: z.string(),
  present: z.boolean().optional(),
  absent_from: z.enum(["git"]).optional(),
});

/** A Claude Code skill was created. */
export const SkillMatcher = z.object({
  type: z.literal("skill"),
  name: z.string().optional(),
  exists: z.boolean().optional(),
});

/**
 * A slash command or skill was invoked at least `gte` times (default 1). This is how a
 * cartridge detects plugin usage that never touches an MCP tool: most plugin workflows
 * are commands (`/postman:mock`), and some shell out rather than calling a tool at all.
 *
 * `name` is a regex so a cartridge can accept a family of commands in one matcher
 * (`"postman:(mock|sync)"`), tested against the normalised `plugin:command` form.
 */
export const CommandMatcher = z.object({
  type: z.literal("command"),
  name: z.string(),
  gte: z.number().int().positive().default(1),
});

/** An aggregate threshold over emitted signals of a given kind. */
export const CountMatcher = z.object({
  type: z.literal("count"),
  of: z.string(), // signal kind, e.g. "mcp.added"
  gte: z.number().int().positive(),
});

/**
 * The escape valve: an LLM judges a subjective practice. Still declarative — the
 * cartridge supplies an input selector + rubric, not code — and gated by confidence
 * so badges aren't granted on a hunch. The engine resolves the verdict externally.
 */
export const LlmJudgeMatcher = z.object({
  type: z.literal("llm_judge"),
  over: z.object({ file: z.string().optional() }).partial(),
  rubric: z.string(),
  confidence_gte: z.number().min(0).max(1).default(0.8),
});

export const LeafMatcher = z.discriminatedUnion("type", [
  BashMatcher,
  FileMatcher,
  DependencyMatcher,
  McpMatcher,
  McpToolMatcher,
  EnvMatcher,
  SkillMatcher,
  CommandMatcher,
  CountMatcher,
  LlmJudgeMatcher,
]);

// --- Composite matchers (allOf / anyOf / not) -----------------------------------
// Typed up-front because zod cannot infer recursive unions on its own.

export type Matcher =
  | z.infer<typeof LeafMatcher>
  | { allOf: Matcher[] }
  | { anyOf: Matcher[] }
  | { not: Matcher };

// Input generic is `unknown` because `.default()` on leaf fields makes the parsed
// (output) type differ from the accepted (input) type; the annotation only pins output.
export const Matcher: z.ZodType<Matcher, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([
    LeafMatcher,
    z.object({ allOf: z.array(Matcher).min(1) }),
    z.object({ anyOf: z.array(Matcher).min(1) }),
    z.object({ not: Matcher }),
  ]),
);

export type LeafMatcherT = z.infer<typeof LeafMatcher>;

export function isComposite(
  m: Matcher,
): m is { allOf: Matcher[] } | { anyOf: Matcher[] } | { not: Matcher } {
  return "allOf" in m || "anyOf" in m || "not" in m;
}
