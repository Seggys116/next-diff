import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Playground" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", color: "#111", background: "#fff" }}>
        <nav style={{ display: "flex", gap: 16, padding: "16px 24px", borderBottom: "1px solid #eee" }}>
          <Link href="/">Home</Link>
          <Link href="/about">About</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
