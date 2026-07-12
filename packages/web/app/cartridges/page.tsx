import { getCartridges, usingSupabase } from "@/lib/data";

export const metadata = { title: "Cartridges — learnmcp" };
export const dynamic = "force-dynamic"; // reflect the live registry per request

export default async function CartridgesPage() {
  const cartridges = await getCartridges();
  return (
    <>
      <h1>Cartridges</h1>
      <p className="lead">
        Each cartridge defines learning objectives, best practices, and badges for a tool.
      </p>
      {!usingSupabase() && (
        <div className="notice">
          Showing the bundled first-party cartridges. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to load the live registry (with install counts and community submissions).
        </div>
      )}
      <div className="grid">
        {cartridges.map((c) => (
          <div className="card" key={c.id}>
            <div className="icon">{c.icon ?? "📦"}</div>
            <div className="name">{c.name}</div>
            <div className="meta">
              {c.objectives > 0 ? `${c.objectives} objectives · ${c.badges} badges` : `${c.installs} installs`}
            </div>
            <span className={`badge-tag ${c.trust}`}>{c.trust}</span>
          </div>
        ))}
      </div>
    </>
  );
}
