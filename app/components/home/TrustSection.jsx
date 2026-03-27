export default function TrustSection() {
  const items = [
    {
      title: "Player value via WAR",
      description: "Use weighted WAR, RAPM, and percentile profiles to quickly spot elite value and role context.",
    },
    {
      title: "Model-driven forecasts",
      description: "Track pregame probabilities, goalie impact, market comparisons, and postgame recaps in one workflow.",
    },
    {
      title: "Team and roster analysis",
      description: "Move from team dashboards into roster-builder and playoff tools without leaving the product ecosystem.",
    },
    {
      title: "Comparison built for debate",
      description: "Put skaters side by side across WAR, ratings, and usage to test real arguments, not just vibes.",
    },
  ];

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ color: "#86a9c6", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em" }}>
          Why this platform
        </div>
        <h2 style={{ margin: 0, color: "var(--text-primary)", fontSize: 34, lineHeight: 1, fontWeight: 900 }}>
          Built for serious hockey fans
        </h2>
      </div>

      <div className="home-trust-grid">
        {items.map((item, index) => (
          <div
            key={item.title}
            style={{
              borderRadius: 24,
              border: "1px solid #1c334a",
              background: "linear-gradient(180deg, rgba(13,20,30,0.98) 0%, rgba(8,13,21,0.98) 100%)",
              padding: 18,
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ color: "#2fb4ff", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              0{index + 1}
            </div>
            <div style={{ color: "var(--text-primary)", fontSize: 22, fontWeight: 900 }}>{item.title}</div>
            <div style={{ color: "#87a6bf", lineHeight: 1.65, fontSize: 14 }}>{item.description}</div>
          </div>
        ))}
      </div>

      <style>{`
        .home-trust-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }
        @media (max-width: 1180px) {
          .home-trust-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 680px) {
          .home-trust-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}
