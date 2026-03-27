/**
 * Shared timeframe selector for fantasy rankings.
 * Depends on Fantasy Hub timeframe config and exposes a compact segmented UI.
 */
import { TIMEFRAME_OPTIONS } from "@/app/components/fantasy-hub/fantasyHubConfig";

export default function FantasyTimeframeSelector({ value, onChange, options = TIMEFRAME_OPTIONS }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          style={{
            borderRadius: 999,
            border: `1px solid ${value === option.key ? "#2fb4ff" : "#213547"}`,
            background: value === option.key ? "rgba(47,180,255,0.14)" : "var(--bg-card)",
            color: value === option.key ? "#d6f0ff" : "#8ca8c1",
            padding: "9px 12px",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontFamily: "'DM Mono',monospace",
            cursor: "pointer",
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
