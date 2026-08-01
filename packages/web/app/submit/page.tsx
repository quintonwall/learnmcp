"use client";

import { useState } from "react";
import { validateCartridge } from "@learnmcp/schema";

const REPO = "https://github.com/quintonwall/learnmcp";

const EXAMPLE = `{
  "id": "my-tool",
  "version": "1.0.0",
  "trust": "community",
  "provider": { "name": "My Tool", "homepage": "https://example.com", "icon": "🧩" },
  "detect": [{ "type": "mcp", "server": "my-tool" }],
  "objectives": [
    {
      "id": "first-thing",
      "title": "Do the first useful thing",
      "why": "Explain why this is worth doing — this text is shown to the learner.",
      "docs": "https://example.com/docs",
      "badge": "starter",
      "criteria": { "type": "mcp_tool", "server": "my-tool", "tool": "doThing" }
    }
  ],
  "bestPractices": [],
  "badges": [
    { "id": "starter", "name": "Starter", "tier": "bronze",
      "description": "Did the first useful thing." }
  ]
}`;

export default function SubmitPage() {
  const [text, setText] = useState(EXAMPLE);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  function onValidate(e: React.FormEvent) {
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
    const c = result.cartridge;
    setStatus({
      ok: true,
      message: `"${c.id}" is valid: ${c.objectives.length} objective(s), ${c.bestPractices.length} best practice(s), ${c.badges.length} badge(s). Add it as cartridges/${c.id}/${c.id}.json and open a pull request.`,
    });
  }

  return (
    <>
      <h1>Contribute a cartridge</h1>
      <p className="lead">
        A cartridge teaches learnmcp about one tool — plain JSON, no executable code. The
        registry is a directory in the repo, so contributing is a pull request. Once it
        merges, every learnmcp picks it up on its next refresh; nothing is redeployed.
      </p>

      <h2>1. Write it</h2>
      <p className="lead">
        Paste your JSON below to check it against the schema before you open a PR. This
        validates in your browser — nothing is uploaded.
      </p>
      <form className="submit" onSubmit={onValidate}>
        <label>
          Cartridge JSON
          <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        </label>
        <button type="submit">Validate</button>
      </form>
      {status && (
        <div className="notice" style={{ borderColor: status.ok ? "#2c5a2c" : "#5a2c2c" }}>
          {status.ok ? "✅ " : "⚠️ "}
          {status.message}
        </div>
      )}

      <h2>2. Open a pull request</h2>
      <p className="lead">
        Add it at <code>cartridges/&lt;id&gt;/&lt;id&gt;.json</code> and open a PR against{" "}
        <a href={REPO}>the repo</a>. CI validates every cartridge on the branch.
      </p>
      <pre>
        <span className="prompt">$ </span>git clone {REPO}.git{"\n"}
        <span className="prompt">$ </span>mkdir -p cartridges/my-tool{"\n"}
        <span className="prompt">$ </span>$EDITOR cartridges/my-tool/my-tool.json{"\n"}
        <span className="prompt">$ </span>npm install && npm test{"\n"}
        <span className="prompt">$ </span>git checkout -b add-my-tool && git commit -am
        &quot;Add my-tool cartridge&quot; && git push
      </pre>
      <p style={{ marginTop: 16 }}>
        <a href={`${REPO}/new/main/cartridges`}>Create the file on GitHub →</a>
        <a href={`${REPO}#contributing-a-cartridge`} style={{ marginLeft: 16 }}>
          Full guide →
        </a>
      </p>

      <div className="notice">
        <strong>Two things reviewers look for.</strong> Matchers should target what the tool
        <em> actually</em> emits — a plugin&rsquo;s slash commands and its MCP tools are
        different names for the same action, so accept both with <code>anyOf</code>. And
        prefer several narrow matchers to one loose regex: a badge that&rsquo;s easy to earn
        by accident isn&rsquo;t worth earning.
      </div>

      <h2>Don&rsquo;t want to write it by hand?</h2>
      <p className="lead">Ask learnmcp to draft one from a docs page, then review and PR it:</p>
      <pre>
        <span className="prompt">You: </span>generate a cartridge from https://example.com/docs
      </pre>
    </>
  );
}
