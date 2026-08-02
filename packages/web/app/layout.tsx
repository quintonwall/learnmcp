import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "learnmcp — vibe learning for the agentic era",
  description: "Vibe learning for the agentic era: a passive, vendor-neutral LMS built entirely on cartridges. Browse cartridges, climb the leaderboard, submit your own.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <div className="wrap">
            <Link href="/" className="brand">🎓 learnmcp</Link>
            <nav>
              <Link href="/cartridges">Cartridges</Link>
              <Link href="/leaderboard">Leaderboard</Link>
              <Link href="/submit">Contribute</Link>
              <a href="https://github.com/sponsors/quintonwall">Sponsor</a>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site">
          <div className="wrap">
            learnmcp — vibe learning, passive and vendor-neutral: observe → recommend → reward.
          </div>
        </footer>
      </body>
    </html>
  );
}
