import { getLeaderboard, getCartridgeLeaders, usingSupabase } from "@/lib/data";

export const metadata = { title: "Leaderboard — learnmcp" };
export const dynamic = "force-dynamic"; // live rankings per request

export default async function LeaderboardPage() {
  const [overall, boards] = await Promise.all([getLeaderboard(), getCartridgeLeaders()]);
  return (
    <>
      <h1>Leaderboard</h1>
      <p className="lead">
        Points come from earned badges (bronze 10 · silver 25 · gold 100) and carry across
        every cartridge. Cross a threshold and you climb the ranks: Novice → Initiate →
        Apprentice → Journeyman → Adept → Expert → Master → Grandmaster → Legend.
      </p>

      {!usingSupabase() ? (
        <div className="notice">
          The leaderboard is powered by Supabase. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to see live rankings synced from developers' sessions.
        </div>
      ) : (
        <>
          <h2>Overall</h2>
          {overall.length === 0 ? (
            <div className="notice">No one on the board yet — be the first to earn a badge.</div>
          ) : (
            <table className="board">
              <thead>
                <tr><th className="pos">#</th><th>Developer</th><th>Rank</th><th className="pts">Points</th></tr>
              </thead>
              <tbody>
                {overall.map((r) => (
                  <tr key={r.position}>
                    <td className="pos">{r.position}</td>
                    <td>{r.handle}</td>
                    <td>{r.rank}</td>
                    <td className="pts">{r.points.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>Leaders by cartridge</h2>
          {boards.length === 0 ? (
            <div className="notice">No per-cartridge scores yet.</div>
          ) : (
            <div className="grid">
              {boards.map((b) => (
                <div className="card" key={b.cartridgeId}>
                  <div className="icon">{b.icon ?? "📦"}</div>
                  <div className="name">{b.name}</div>
                  <table className="board" style={{ marginTop: 8 }}>
                    <tbody>
                      {b.rows.map((r) => (
                        <tr key={r.position}>
                          <td className="pos">{r.position}</td>
                          <td>{r.handle}</td>
                          <td className="pts">{r.points.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
