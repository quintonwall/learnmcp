import { it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CartridgeRegistry } from "../src/registry.js";
import { evaluateProject } from "../src/detection.js";

const bundled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../cartridges");
const sid = { kind: "env", key: "TWILIO_ACCOUNT_SID" } as never;
const token = { kind: "env", key: "TWILIO_AUTH_TOKEN" } as never;
const apiKey = { kind: "env", key: "TWILIO_API_KEY_SID" } as never;
const apiSecret = { kind: "env", key: "TWILIO_API_KEY_SECRET" } as never;

it("awards Keys in the Env only when the account SID and a secret are both set", async () => {
  const registry = new CartridgeRegistry({ sources: [bundled] });
  await registry.load();
  const earned = (signals: never[]) =>
    evaluateProject(registry.list(), signals, new Map() as never).grantedBadges.some(
      (b) => b.badgeId === "keys-in-the-env",
    );

  expect(earned([sid, token])).toBe(true);
  expect(earned([sid, apiKey, apiSecret])).toBe(true);
  expect(earned([sid, apiKey])).toBe(false); // API key SID without its secret
  expect(earned([sid])).toBe(false); // no secret
  expect(earned([token])).toBe(false); // no account SID
});
