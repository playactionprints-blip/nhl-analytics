"use client";

import { useRouter, useSearchParams } from "next/navigation";

const LABEL_STYLE = {
  color: "#5a7a99",
  fontSize: 10,
  fontFamily: "'DM Mono',monospace",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

export default function TeamsSeasonFilter({ seasonOptions, selectedSeasons }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function persistSelections(nextSeasons) {
    const normalized = seasonOptions
      .map((option) => option.value)
      .filter((season) => nextSeasons.includes(season));

    const params = new URLSearchParams(searchParams?.toString() || "");
    params.delete("season");
    params.delete("war");
    params.set("seasons", normalized.join(","));

    const query = params.toString();
    router.replace(query ? `/teams?${query}` : "/teams");
  }

  function toggleSeason(season) {
    const next = selectedSeasons.includes(season)
      ? selectedSeasons.filter((value) => value !== season)
      : [...selectedSeasons, season];

    if (!next.length) return;
    persistSelections(next);
  }

  function applyPreset(count) {
    persistSelections(seasonOptions.slice(0, count).map((option) => option.value));
  }

  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        minWidth: 260,
      }}
    >
      <div style={{ display: "grid", gap: 4 }}>
        <div style={LABEL_STYLE}>Included Seasons</div>
        <div
          style={{
            color: "#7d9ab6",
            fontSize: 11,
            fontFamily: "'DM Mono',monospace",
          }}
        >
          Select the seasons included in team WAR.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => applyPreset(1)}
          style={presetButtonStyle}
        >
          Current
        </button>
        <button
          type="button"
          onClick={() => applyPreset(Math.min(2, seasonOptions.length))}
          style={presetButtonStyle}
        >
          Last 2
        </button>
        <button
          type="button"
          onClick={() => applyPreset(Math.min(3, seasonOptions.length))}
          style={presetButtonStyle}
        >
          Last 3
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {seasonOptions.map((option) => {
          const checked = selectedSeasons.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggleSeason(option.value)}
              aria-pressed={checked}
              style={{
                borderRadius: 999,
                border: checked ? "1px solid #3b82f6" : "1px solid #213547",
                background: checked ? "linear-gradient(180deg,#12263d,#0d1722)" : "#0f1823",
                color: checked ? "#e8f5ff" : "#7d9ab6",
                padding: "10px 14px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "'Barlow Condensed',sans-serif",
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  border: checked ? "1px solid #60a5fa" : "1px solid #35506c",
                  background: checked ? "#173452" : "transparent",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#8fd3ff",
                  fontSize: 10,
                  lineHeight: 1,
                }}
              >
                {checked ? "✓" : ""}
              </span>
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const presetButtonStyle = {
  borderRadius: 999,
  border: "1px solid #1d3248",
  background: "#0b131d",
  color: "#8aa6c1",
  padding: "6px 10px",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "'DM Mono',monospace",
};
