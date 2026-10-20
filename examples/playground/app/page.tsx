export default function Home() {
  return (
    <main>
      {/* A full-window hero: it is sized with 100vh, so it only looks right if the viewer's copy has the same window size. */}
      <section style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "linear-gradient(160deg,#eff6ff,#dbeafe)", textAlign: "center", padding: 24 }}>
        <div style={{ maxWidth: 640 }}>
          <h1 style={{ fontSize: 52, margin: 0 }}>Playground (local)</h1>
          <p style={{ fontSize: 18, color: "#334155" }}>This is the version you are working on. It is a little different from the live copy.</p>
          <button style={{ padding: "12px 22px", background: "#2563eb", color: "#fff", border: 0, borderRadius: 10, fontSize: 16 }}>Get started</button>
        </div>
      </section>
      <section style={{ padding: "64px 24px", maxWidth: 720, margin: "0 auto" }}>
        <h2>What's new</h2>
        <p>A new paragraph that only exists locally.</p>
        <p>Scroll position should carry over into the viewer.</p>
      </section>
    </main>
  );
}
