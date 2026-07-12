import { z } from "zod";
import { Matcher } from "./matchers.js";

/**
 * A cartridge is pure declarative DATA — never code. The engine loads it at runtime,
 * so adding one never requires redeploying the server (see packages/server registry).
 */

export const BadgeTier = z.enum(["bronze", "silver", "gold", "platinum"]);
export type BadgeTier = z.infer<typeof BadgeTier>;

export const Badge = z.object({
  id: z.string(),
  name: z.string(),
  tier: BadgeTier.optional(),
  description: z.string().optional(),
  /** Points this badge is worth. Defaults from `tier` when omitted (see ranks.ts). */
  points: z.number().int().nonnegative().optional(),
  /** Optional self-contained criteria; a badge may instead be granted by an objective. */
  criteria: Matcher.optional(),
});
export type Badge = z.infer<typeof Badge>;

export const Objective = z.object({
  id: z.string(),
  title: z.string(),
  docs: z.string().url().optional(),
  why: z.string().optional(),
  /** The declarative detector: how the engine knows this was completed. */
  criteria: Matcher,
  /** Id of a badge (in this cartridge) to grant when the criteria are met. */
  badge: z.string().optional(),
  /** Marks recommended-but-optional practices vs. core objectives. */
  recommended: z.boolean().optional(),
});
export type Objective = z.infer<typeof Objective>;

export const Provider = z.object({
  name: z.string(),
  homepage: z.string().url().optional(),
  icon: z.string().optional(),
});

export const Trust = z.enum(["official", "community", "generated"]);
export type Trust = z.infer<typeof Trust>;

export const Cartridge = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "id must be kebab-case: [a-z0-9-]"),
  version: z.string(),
  provider: Provider,
  trust: Trust.default("community"),
  /** When is this cartridge relevant to a project? Any matcher that hits installs it. */
  detect: z.array(Matcher).default([]),
  objectives: z.array(Objective).default([]),
  bestPractices: z.array(Objective).default([]),
  badges: z.array(Badge).default([]),
});
export type Cartridge = z.infer<typeof Cartridge>;

export type CartridgeValidation =
  | { ok: true; cartridge: Cartridge }
  | { ok: false; error: string };

/** Parse + validate untrusted cartridge JSON. Never throws — safe for the loader. */
export function validateCartridge(input: unknown): CartridgeValidation {
  const result = Cartridge.safeParse(input);
  if (result.success) return { ok: true, cartridge: result.data };
  const first = result.error.issues[0];
  const path = first?.path.join(".") || "(root)";
  return { ok: false, error: `${path}: ${first?.message ?? "invalid cartridge"}` };
}
