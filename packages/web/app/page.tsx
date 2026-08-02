import Link from "next/link";
import { getCartridges, getPlatformStats } from "@/lib/data";

export const dynamic = "force-dynamic";

const REPO = "https://github.com/quintonwall/learnmcp";

export default async function HomePage() {
  const [cartridges, stats] = await Promise.all([getCartridges(), getPlatformStats()]);
  return (
    <>
      <h1>Learn best practices as you build.</h1>
      <p className="lead">
        learnmcp lives inside your Claude Code session, watches what you build, suggests the
        next best practice to try, and rewards you with badges when you do it. No courses,
        no fixed path — your real work is the curriculum.
      </p>

      {stats && (stats.lessonsCompleted > 0 || stats.activeLearners > 0) && (
        <p className="stat-banner">
          <strong>{stats.activeLearners.toLocaleString()}</strong> developers have completed{" "}
          <strong>{stats.lessonsCompleted.toLocaleString()}</strong> lessons.
        </p>
      )}

      <pre>
        <span className="prompt">You: </span>Can you generate an OpenAPI spec in Postman for this codebase?{"\n\n"}
        <span className="out">
          learnmcp — 🏅 Spec Author (+10) · ✅ Generate an OpenAPI spec from your codebase
          {"\n"}           · Initiate · 10 pts (90 to Apprentice)
          {"\n"}           · Next: Sync your spec to a Postman collection
        </span>
      </pre>

      <h2>Install</h2>
      <p className="lead">Two commands. No account, no API key, nothing to configure.</p>
      <pre>
        <span className="prompt">$ </span>claude plugin marketplace add quintonwall/learnmcp{"\n"}
        <span className="prompt">$ </span>claude plugin install learnmcp@quintonwall
      </pre>
      <p className="lead">
        Restart Claude Code and you&rsquo;re done. The plugin talks to the hosted server at{" "}
        <code>learnmcp.ai</code> and creates an anonymous learner the first time it records
        anything — your badges start saving immediately, with no sign-up.
      </p>

      <div className="cta">
        <a className="primary" href={REPO}>
          View on GitHub
        </a>
        <Link href="/cartridges">Browse cartridges</Link>
        <Link href="/leaderboard">Leaderboard</Link>
      </div>

      <h2>Using it</h2>
      <div className="steps">
        <div className="step">
          <h3>Just work</h3>
          <p>
            Use a tool learnmcp knows — Postman, Playwright, Supabase, GitHub — and the
            matching track activates on its own. You&rsquo;ll see the next suggestion at
            session start.
          </p>
        </div>
        <div className="step">
          <h3>Do the thing it suggests</h3>
          <p>
            Run the command, call the tool, or just write the file. The badge fires by
            itself — you never tell learnmcp you did something.
          </p>
        </div>
        <div className="step">
          <h3>Climb</h3>
          <p>
            Bronze 10 points, silver 25, gold 100, accumulating across every tool into one
            rank: Novice → Initiate → Apprentice → Journeyman → Adept → Expert → Master →
            Grandmaster → Legend.
          </p>
        </div>
      </div>

      <p className="lead">
        Ask in plain language — <em>&ldquo;what should I learn next?&rdquo;</em>,{" "}
        <em>&ldquo;where am I on the leaderboard?&rdquo;</em> — or use the commands:
      </p>
      <pre>
        <span className="prompt">/learn</span>      the next thing worth doing{"\n"}
        <span className="prompt">/badges</span>     what you&rsquo;ve earned{"\n"}
        <span className="prompt">/progress</span>   your points, rank, and standing{"\n"}
        <span className="prompt">/cartridge</span>  what it can teach; refresh the registry
      </pre>

      <div className="notice">
        <strong>Prefer to keep it off the cloud?</strong> Set <code>LEARNMCP_LOCAL=1</code>{" "}
        and it opts out of tracking entirely — no leaderboard, no cartridge popularity,
        nothing sent anywhere.
      </div>

      <div className="notice">
        <strong>Not on Claude Code?</strong> learnmcp is a plain MCP server — point Codex,
        Cursor, or your own client at <code>https://learnmcp.ai/mcp</code> directly. You
        lose passive detection (no hooks means the model has to call{" "}
        <code>record_activity</code> itself) and, unless your client can hold a static auth
        header, persistent identity too. Full details in{" "}
        <a href={`${REPO}#not-on-claude-code`}>the README</a>.
      </div>

      <h2>Your profile</h2>
      <p className="lead">
        There is no sign-up. The first time learnmcp records anything it mints an anonymous
        learner and stores a token at <code>~/.learnmcp/token</code> — that token{" "}
        <em>is</em> your identity, so back it up if you care about your streak. You show on
        the <Link href="/leaderboard">leaderboard</Link> straight away as something like{" "}
        <code>learner-7f3c</code>.
      </p>
      <div className="notice">
        <strong>Want your name on it instead?</strong> No sign-in — just say{" "}
        <em>&ldquo;claim the handle quinton&rdquo;</em>. Your existing token is already proof
        it&rsquo;s your progress to name; there&rsquo;s no account behind it, so it&rsquo;s
        first-come-first-served on the name, the same as an arcade high-score list.
      </div>

      <h2>Add a tool it doesn&rsquo;t know yet</h2>
      <p className="lead">
        Cartridges are plain JSON with no executable code, and the registry is a directory
        in the repo — so teaching learnmcp a new tool is a pull request. Validate yours in
        the browser first, then open the PR.
      </p>
      <div className="cta">
        <Link className="primary" href="/submit">
          Contribute a cartridge
        </Link>
        <a href={`${REPO}/tree/main/cartridges`}>See existing ones</a>
      </div>

      <h2>{cartridges.length} cartridges available</h2>
      <p className="lead">
        A cartridge is what teaches one tool — plain JSON, no code. They live in{" "}
        <a href={`${REPO}/tree/main/cartridges`}>the repo</a>, so adding support for a new
        service is a pull request. Once it merges, every learnmcp picks it up on its next
        refresh — nothing is redeployed.
      </p>
      <p style={{ marginTop: 16 }}>
        <Link href="/cartridges">Browse all cartridges →</Link>
        <a href={`${REPO}#contributing-a-cartridge`} style={{ marginLeft: 16 }}>
          Write one →
        </a>
      </p>
    </>
  );
}
