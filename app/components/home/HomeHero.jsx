import Link from "next/link";

export default function HomeHero({ quickLinks = [] }) {
  return (
    <section
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 30,
        border: "1px solid #18314a",
        background: "radial-gradient(circle at top left, rgba(47,180,255,0.18) 0%, rgba(7,12,20,0.98) 40%, rgba(6,10,16,0.98) 100%)",
        padding: "34px 32px 30px",
        boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "auto -80px -120px auto",
          width: 320,
          height: 320,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(18,107,185,0.28) 0%, rgba(18,107,185,0) 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: "-90px auto auto -100px",
          width: 280,
          height: 280,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(70,190,255,0.16) 0%, rgba(70,190,255,0) 72%)",
          pointerEvents: "none",
        }}
      />

      <div className="home-hero-grid" style={{ position: "relative", zIndex: 1 }}>
        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ color: "#8eb9db", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            NHL analytics platform
          </div>
          <div style={{ color: "#f2fbff", fontSize: 64, lineHeight: 0.92, fontWeight: 900, maxWidth: 760 }}>
            NHL analytics, predictions, and player value in one place.
          </div>
          <div style={{ color: "#95adc3", fontSize: 18, lineHeight: 1.6, maxWidth: 760 }}>
            Explore model-driven game predictions, player WAR rankings, team insights, playoff tools, and comparison workflows built for serious hockey fans.
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link
              href="/predictions"
              style={{
                borderRadius: 999,
                background: "linear-gradient(180deg, #2fb4ff 0%, #1291d5 100%)",
                color: "#04111d",
                padding: "12px 18px",
                textDecoration: "none",
                fontWeight: 900,
                fontSize: 14,
                boxShadow: "0 12px 24px rgba(18,145,213,0.22)",
              }}
            >
              View Predictions
            </Link>
            <Link
              href="/players"
              style={{
                borderRadius: 999,
                border: "1px solid #2a4b69",
                background: "#0f1a27",
                color: "#dff3ff",
                padding: "12px 18px",
                textDecoration: "none",
                fontWeight: 800,
                fontSize: 14,
              }}
            >
              Explore Players
            </Link>
          </div>
        </div>

        <div className="home-quick-grid">
          {quickLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                textDecoration: "none",
                borderRadius: 22,
                border: "1px solid #1c334a",
                background: "linear-gradient(180deg, rgba(14,22,33,0.96) 0%, rgba(10,16,24,0.96) 100%)",
                padding: "16px 16px 14px",
                display: "grid",
                gap: 8,
                transition: "transform 120ms ease, border-color 120ms ease, background 120ms ease",
              }}
            >
              <div style={{ color: item.accent, fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {item.kicker}
              </div>
              <div style={{ color: "#eff8ff", fontSize: 20, fontWeight: 900 }}>{item.title}</div>
              <div style={{ color: "#89a6be", lineHeight: 1.5, fontSize: 14 }}>{item.description}</div>
            </Link>
          ))}
        </div>
      </div>

      <style>{`
        .home-hero-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.92fr);
          gap: 22px;
          align-items: start;
        }
        .home-quick-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .home-quick-grid a:hover {
          transform: translateY(-2px);
          border-color: #2e5b80;
          background: linear-gradient(180deg, rgba(16,26,39,0.98) 0%, rgba(11,18,27,0.98) 100%);
        }
        @media (max-width: 1024px) {
          .home-hero-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 640px) {
          .home-quick-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}

