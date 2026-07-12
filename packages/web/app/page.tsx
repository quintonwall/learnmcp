import Link from "next/link";
import { getCartridges } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cartridges = await getCartridges();
  return (
    <>
      <h1>Learn best practices as you build.</h1>
      <p className="lead">
        learnmcp lives inside your Claude Code or Codex session, watches what you build,
        suggests the next best practice to try, and rewards you with badges when you do —
        driven by pluggable <strong>cartridges</strong>. The loop is: observe → recommend → reward.
      </p>

      <h2>How it works</h2>
      <div className="grid">
        <div className="card">
          <div className="icon">🛰️</div>
          <div className="name">1. It watches</div>
          <div className="meta">Hooks turn what you do — add an MCP server, run a test, edit a file — into signals.</div>
        </div>
        <div className="card">
          <div className="icon">🎯</div>
          <div className="name">2. It suggests</div>
          <div className="meta">The engine recommends the single next best practice or feature for your project.</div>
        </div>
        <div className="card">
          <div className="icon">🏅</div>
          <div className="name">3. It rewards</div>
          <div className="meta">Cartridge matchers detect what you did and grant badges, points, and ranks.</div>
        </div>
      </div>

      <h2>{cartridges.length} cartridges available</h2>
      <p className="lead">
        Each cartridge teaches a tool: Postman, Playwright, Supabase, GitHub, and more —
        or generate one from any docs URL.
      </p>
      <p style={{ marginTop: 16 }}>
        <Link href="/cartridges">Browse all cartridges →</Link>
      </p>
    </>
  );
}
