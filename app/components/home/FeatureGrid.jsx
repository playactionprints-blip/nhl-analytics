import Link from "next/link";

export default function FeatureGrid({ items = [] }) {
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ color: "#86a9c6", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em" }}>
          Platform overview
        </div>
        <h2 style={{ margin: 0, color: "#eef8ff", fontSize: 34, lineHeight: 1, fontWeight: 900 }}>
          Explore the full toolkit
        </h2>
      </div>

      <div className="home-feature-grid">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            style={{
              textDecoration: "none",
              borderRadius: 24,
              border: "1px solid #1c334a",
              background: "linear-gradient(180deg, rgba(13,20,30,0.98) 0%, rgba(8,13,21,0.98) 100%)",
              padding: 18,
              display: "grid",
              gap: 10,
              minHeight: 180,
              boxShadow: "0 18px 40px rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 14,
                  background: item.accentBg,
                  border: `1px solid ${item.accent}40`,
                  color: item.accent,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 13,
                  fontWeight: 900,
                  fontFamily: "'DM Mono',monospace",
                }}
              >
                {item.icon}
              </div>
              <div style={{ color: item.accent, fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {item.kicker}
              </div>
            </div>
            <div style={{ color: "#eef8ff", fontSize: 24, fontWeight: 900 }}>{item.title}</div>
            <div style={{ color: "#87a6bf", lineHeight: 1.65, fontSize: 14 }}>{item.description}</div>
            <div style={{ marginTop: "auto", color: "#d8efff", fontSize: 13, fontWeight: 800 }}>
              Open {item.title}
            </div>
          </Link>
        ))}
      </div>

      <style>{`
        .home-feature-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }
        .home-feature-grid a:hover {
          border-color: #315a7f;
          transform: translateY(-2px);
        }
        @media (max-width: 1180px) {
          .home-feature-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 680px) {
          .home-feature-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}
