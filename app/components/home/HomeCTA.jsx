import Link from "next/link";

export default function HomeCTA() {
  return (
    <section
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 30,
        border: "1px solid #193149",
        background: "linear-gradient(180deg, rgba(14,21,31,0.98) 0%, rgba(8,12,20,0.98) 100%)",
        padding: "28px 26px",
        boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "auto -40px -80px auto",
          width: 220,
          height: 220,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(47,180,255,0.18) 0%, rgba(47,180,255,0) 70%)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", zIndex: 1, display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ color: "#86a9c6", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em" }}>
            Start here
          </div>
          <h2 style={{ margin: 0, color: "#eef8ff", fontSize: 34, lineHeight: 1, fontWeight: 900 }}>
            Start exploring the NHL through analytics.
          </h2>
          <div style={{ color: "#8ba7bf", fontSize: 16, lineHeight: 1.7, maxWidth: 760 }}>
            Jump into today&apos;s forecasts, browse player value, or move straight into the tools built for lineup debates and roster-building sessions.
          </div>
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
            }}
          >
            Open Predictions
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
            Search Players
          </Link>
        </div>
      </div>
    </section>
  );
}
