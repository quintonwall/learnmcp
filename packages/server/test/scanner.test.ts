import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject, envKeyNames, isEnvFile, scrubSecrets } from "../src/scanner.js";

describe("scanProject and secrets", () => {
  it("reports .env key names but never their values", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "scan-"));
    try {
      writeFileSync(
        path.join(dir, ".env"),
        "TWILIO_ACCOUNT_SID=ACsecretsid123\nexport TWILIO_AUTH_TOKEN=supersecrettoken\n# a comment\nEMPTY=\n",
      );
      writeFileSync(path.join(dir, "prod.env"), "STRIPE_KEY=sk_live_abc\n");
      writeFileSync(path.join(dir, "README.md"), "hello\n");

      const signals = scanProject(dir);
      const wire = JSON.stringify(signals);

      expect(wire).not.toContain("ACsecretsid123");
      expect(wire).not.toContain("supersecrettoken");
      expect(wire).not.toContain("sk_live_abc");

      const keys = signals.filter((s) => s.kind === "env").map((s) => (s as { key: string }).key);
      expect(keys).toEqual(expect.arrayContaining(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "EMPTY", "STRIPE_KEY"]));

      // The file is still reported as existing, just without content.
      const envFile = signals.find((s) => s.kind === "file" && s.path === ".env");
      expect(envFile).toEqual({ kind: "file", path: ".env", event: "exists" });
      // Other files keep their content.
      const readme = signals.find((s) => s.kind === "file" && s.path === "README.md");
      expect((readme as { content?: string }).content).toBe("hello\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recognises env files by name", () => {
    expect(isEnvFile(".env")).toBe(true);
    expect(isEnvFile("app/.env.local")).toBe(true);
    expect(isEnvFile("prod.env")).toBe(true);
    expect(isEnvFile("config\\.env.local")).toBe(true);
    expect(isEnvFile("C:\\app\\.ENV")).toBe(true);
    expect(isEnvFile("environment.md")).toBe(false);
  });

  it("reads plain keys, with export, colon and comments", () => {
    expect(envKeyNames("A=1\n  export B = 2\n#C=3\nD: 4\nlower=5\nMixed_Case=6\nE_1='quoted'\nF=\"x\"")).toEqual([
      "A",
      "B",
      "D",
      "E_1",
      "F",
    ]);
  });

  it("stops at any line that may open a multi-line value, whatever the syntax", () => {
    const cases = [
      'PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nQUJD=\nYWJjZA==\n-----END-----"\nAFTER=1',
      'PRIVATE_KEY: "header\nQUJD=\nfooter"\nAFTER=1',
      'TLS.KEY="header\nQUJD=\nfooter"\nAFTER=1',
      "K='it\\'s\nQUJD=\nend'\nAFTER=1",
      "K=`tick\nQUJD=\n`\nAFTER=1",
      'K="line one\\\\"\nQUJDRA==\nmore"\nAFTER=1',
      'K="a\\"b\nQUJDRA==\nz"\nAFTER=1',
    ];
    for (const text of cases) {
      const keys = envKeyNames(`SAFE=1\n${text}`);
      expect(keys).not.toContain("QUJD");
      expect(keys).not.toContain("AFTER");
      expect(keys).toContain("SAFE");
    }
  });

  it("scrubs .env content from signals sent by an older client", () => {
    const out = scrubSecrets({
      kind: "file",
      path: "app/.env",
      event: "exists",
      content: "TWILIO_AUTH_TOKEN=supersecret\nOTHER=1\n",
      project: "p-1",
    } as never);
    expect(JSON.stringify(out)).not.toContain("supersecret");
    expect(out[0]).toEqual({ kind: "file", path: "app/.env", event: "exists", project: "p-1" });
    expect(out.slice(1)).toEqual([
      { kind: "env", key: "TWILIO_AUTH_TOKEN", project: "p-1" },
      { kind: "env", key: "OTHER", project: "p-1" },
    ]);
    const readme = { kind: "file", path: "README.md", event: "exists", content: "hi" } as never;
    expect(scrubSecrets(readme)).toEqual([readme]);
  });

  it("never stores .env content when recorded through the service", async () => {
    const { ProgressService } = await import("../src/service.js");
    const { CartridgeRegistry } = await import("../src/registry.js");
    const { SqliteStore } = await import("../src/store.js");
    const bundled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../cartridges");
    const registry = new CartridgeRegistry({ sources: [bundled] });
    await registry.load();
    const store = new SqliteStore({ path: ":memory:" });
    const service = new ProgressService(registry, store);

    service.recordMany("scope", [
      { kind: "file", path: ".env", event: "exists", content: "TWILIO_AUTH_TOKEN=supersecret\n" } as never,
    ]);

    const stored = JSON.stringify(store.getSignals("scope"));
    expect(stored).not.toContain("supersecret");
    expect(stored).toContain("TWILIO_AUTH_TOKEN");
  });
});
