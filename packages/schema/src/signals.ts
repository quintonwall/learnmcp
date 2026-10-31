import { z } from "zod";

/**
 * Which project a signal was observed in: an opaque id (folder name + short path hash,
 * computed on the client so the full path never leaves the machine). Optional because
 * older rows and user-level signals (plugins, env) belong to no one project. It lives in
 * the payload, so the same file seen in two projects is two signals, not one.
 */
const project = z.string().optional();

/**
 * A signal is anything observable in a session, emitted by the hooks/scan layer and
 * fed to the detection engine. Signals are the raw facts; matchers (see matchers.ts)
 * are the predicates cartridges evaluate against them.
 */

export const BashSignal = z.object({
  project,
  kind: z.literal("bash"),
  command: z.string(),
});

export const FileSignal = z.object({
  project,
  kind: z.literal("file"),
  path: z.string(),
  event: z.enum(["add", "change", "exists"]).default("exists"),
  content: z.string().optional(),
});

export const DependencySignal = z.object({
  project,
  kind: z.literal("dependency"),
  name: z.string(),
  manifest: z.string(),
});

export const McpAddedSignal = z.object({
  project,
  kind: z.literal("mcp.added"),
  server: z.string(),
});

export const McpToolSignal = z.object({
  project,
  kind: z.literal("mcp_tool"),
  server: z.string(),
  tool: z.string(),
});

export const SkillSignal = z.object({
  project,
  kind: z.literal("skill"),
  name: z.string(),
});

/**
 * A slash command or skill was *invoked* (distinct from SkillSignal, which means a skill
 * was authored). Plugins expose most of their value through commands rather than MCP
 * tools — `/postman:mock` is a command, not an `mcp__postman__mock` call — so without
 * this the whole plugin surface is invisible to detection.
 *
 * `name` is normalised to `plugin:command` with no leading slash and no arguments.
 */
export const CommandSignal = z.object({
  project,
  kind: z.literal("command"),
  name: z.string(),
});

export const EnvSignal = z.object({
  project,
  kind: z.literal("env"),
  key: z.string(),
  /** where the key was observed; used by `absent_from` matchers */
  inGit: z.boolean().optional(),
});

export const Signal = z.discriminatedUnion("kind", [
  BashSignal,
  FileSignal,
  DependencySignal,
  McpAddedSignal,
  McpToolSignal,
  SkillSignal,
  CommandSignal,
  EnvSignal,
]);

export type Signal = z.infer<typeof Signal>;
export type SignalKind = Signal["kind"];
