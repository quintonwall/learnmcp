import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "learnmcp — learn as you build",
  description: "A dynamic, in-session LMS for building with LLMs. Browse cartridges, climb the leaderboard, submit your own.",
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
              <Link href="/submit">Submit</Link>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site">
          <div className="wrap">
            learnmcp — observe → recommend → reward. Learn best practices as you build with LLMs.
          </div>
        </footer>
      </body>
    </html>
  );
}
