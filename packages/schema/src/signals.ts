import { z } from "zod";

/**
 * A signal is anything observable in a session, emitted by the hooks/scan layer and
 * fed to the detection engine. Signals are the raw facts; matchers (see matchers.ts)
 * are the predicates cartridges evaluate against them.
 */

export const BashSignal = z.object({
  kind: z.literal("bash"),
  command: z.string(),
});

export const FileSignal = z.object({
  kind: z.literal("file"),
  path: z.string(),
  event: z.enum(["add", "change", "exists"]).default("exists"),
  content: z.string().optional(),
});

export const DependencySignal = z.object({
  kind: z.literal("dependency"),
  name: z.string(),
  manifest: z.string(),
});

export const McpAddedSignal = z.object({
  kind: z.literal("mcp.added"),
  server: z.string(),
});

export const McpToolSignal = z.object({
  kind: z.literal("mcp_tool"),
  server: z.string(),
  tool: z.string(),
});

export const SkillSignal = z.object({
  kind: z.literal("skill"),
  name: z.string(),
});

export const EnvSignal = z.object({
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
  EnvSignal,
]);

export type Signal = z.infer<typeof Signal>;
export type SignalKind = Signal["kind"];
