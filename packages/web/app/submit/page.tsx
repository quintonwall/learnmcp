"use client";

import { useState } from "react";
import { validateCartridge } from "@learnmcp/schema";

const EXAMPLE = `{
  "id": "my-tool",
  "version": "1.0.0",
  "provider": { "name": "My Tool", "homepage": "https://example.com", "icon": "🧩" },
  "detect": [{ "type": "mcp", "server": "my-tool" }],
  "objectives": [],
  "bestPractices": [],
  "badges": []
}`;

export default function SubmitPage() {
  const [text, setText] = useState(EXAMPLE);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setStatus({ ok: false, message: `Not valid JSON: ${(err as Error).message}` });
      return;
    }
    const result = validateCartridge(parsed);
    if (!result.ok) {
      setStatus({ ok: false, message: `Invalid cartridge — ${result.error}` });
      return;
    }
    // A real submission inserts into Supabase's moderation queue (approved=false) once
    // the user is signed in. Here we validate client-side and confirm.
    setStatus({
      ok: true,
      message: `"${result.cartridge.id}" is a valid cartridge with ${result.cartridge.objectives.length} objectives and ${result.cartridge.badges.length} badges. It would be queued for moderation.`,
    });
  }

  return (
    <>
      <h1>Submit a cartridge</h1>
      <p className="lead">
        Cartridges are pure declarative data — no code. Paste your cartridge JSON below;
        it's validated against the schema before submission. Approved cartridges appear in
        the gallery and are hot-loaded into developers' sessions.
      </p>
      <form className="submit" onSubmit={onSubmit}>
        <label>
          Cartridge JSON
          <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        </label>
        <button type="submit">Validate & submit</button>
      </form>
      {status && (
        <div className="notice" style={{ borderColor: status.ok ? "#2c5a2c" : "#5a2c2c" }}>
          {status.ok ? "✅ " : "⚠️ "}
          {status.message}
        </div>
      )}
    </>
  );
}
