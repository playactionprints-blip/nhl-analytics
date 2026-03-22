import { TEAM_COLOR } from "@/app/lib/nhlTeams";
import { hexToRgba } from "./postgameAnalytics";

function momentTitle(moment) {
  if (moment.goalModifier) return moment.goalModifier;
  if (moment.shotType) return moment.shotType;
  return "Goal";
}

function periodLabel(desc) {
  if (!desc) return "Period";
  if (desc.periodType === "OT") return "Overtime";
  if (desc.periodType === "SO") return "Shootout";
  const n = desc.number;
  return ["1st Period", "2nd Period", "3rd Period"][n - 1] ?? `Period ${n}`;
}

export default function KeyMomentsPanel({ moments = [], compact = false }) {
  if (!moments.length) {
    return (
      <div
        style={{
          borderRadius: 24,
          border: "1px solid #16283a",
          background: "#0a121c",
          padding: "22px",
          color: "#6f879f",
          fontFamily: "'DM Mono',monospace",
          fontSize: 12,
        }}
      >
        No key moments available.
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: 24,
        border: "1px solid #16283a",
        background: "#0a121c",
        padding: compact ? "18px" : "22px",
        display: "grid",
        gap: 14,
      }}
    >
      <div>
        <div style={{ color: "#8eb9db", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Highlights
        </div>
        <div style={{ color: "#eff8ff", fontSize: compact ? 22 : 26, fontWeight: 900, marginTop: 4 }}>Key moments</div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {moments.map((moment) => {
          const teamColor = TEAM_COLOR[moment.teamAbbrev?.default] || "#4d82af";
          return (
            <article
              key={`${moment.eventId}-${moment.playerId}`}
              style={{
                borderRadius: 18,
                border: `1px solid ${hexToRgba(teamColor, 0.28)}`,
                background: "linear-gradient(135deg, rgba(12,20,30,0.98) 0%, rgba(9,15,23,0.98) 70%)",
                padding: "14px 16px",
                display: "grid",
                gap: 12,
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "52px minmax(0,1fr) auto", gap: 12, alignItems: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={moment.headshotUrl || ""}
                  alt={moment.displayName}
                  width={52}
                  height={52}
                  style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover", background: "#101a24", border: `1px solid ${hexToRgba(teamColor, 0.3)}` }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "#eff8ff", fontSize: 17, fontWeight: 900, lineHeight: 1.1 }}>{moment.displayName}</div>
                  <div style={{ color: "#8aa3bc", fontSize: 12, marginTop: 4 }}>{periodLabel(moment.periodDescriptor)} · {moment.timeInPeriod}</div>
                </div>
                <div
                  style={{
                    borderRadius: 999,
                    padding: "6px 10px",
                    border: `1px solid ${hexToRgba(teamColor, 0.34)}`,
                    background: hexToRgba(teamColor, 0.14),
                    color: teamColor,
                    fontSize: 10,
                    fontFamily: "'DM Mono',monospace",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  {moment.teamAbbrev?.default}
                </div>
              </div>

              <div className="key-moment-meta-grid">
                {[
                  ["Event", momentTitle(moment)],
                  ["Score after", moment.scoreLine],
                  ["Swing", `${moment.swing >= 0 ? "+" : ""}${(moment.swing * 100).toFixed(1)}%`],
                ].map(([label, value]) => (
                  <div key={`${moment.eventId}-${label}`} style={{ borderRadius: 14, background: "#0f1822", border: "1px solid #1b2c3f", padding: "10px 12px" }}>
                    <div style={{ color: "#728ca5", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
                    <div style={{ color: label === "Swing" ? teamColor : "#eff8ff", fontSize: 15, fontWeight: 800, marginTop: 6 }}>{value}</div>
                  </div>
                ))}
              </div>

              {moment.highlightClipSharingUrl ? (
                <a
                  href={moment.highlightClipSharingUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    width: "fit-content",
                    borderRadius: 999,
                    padding: "7px 11px",
                    border: `1px solid ${hexToRgba(teamColor, 0.34)}`,
                    background: hexToRgba(teamColor, 0.12),
                    color: teamColor,
                    textDecoration: "none",
                    fontSize: 11,
                    fontFamily: "'DM Mono',monospace",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Watch highlight
                </a>
              ) : null}
            </article>
          );
        })}
      </div>

      <style>{`
        .key-moment-meta-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        @media (max-width: 700px) {
          .key-moment-meta-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

