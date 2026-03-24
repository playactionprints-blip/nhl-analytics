"use client";

import { useRouter, useSearchParams } from "next/navigation";

const LABEL_STYLE = {
  color: "#5a7a99",
  fontSize: 10,
  fontFamily: "'DM Mono',monospace",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

export default function TeamsSeasonFilter({
  seasonOptions,
  seasonValue,
  warModeOptions,
  warModeValue,
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function updateParams(updates) {
    const params = new URLSearchParams(searchParams?.toString() || "");

    Object.entries(updates).forEach(([key, nextValue]) => {
      if (!nextValue) {
        params.delete(key);
      } else {
        params.set(key, nextValue);
      }
    });

    const query = params.toString();
    router.replace(query ? `/teams?${query}` : "/teams");
  }

  return (
    <>
      <div
        style={{
          display: "grid",
          gap: 6,
          minWidth: 180,
        }}
      >
        <div style={LABEL_STYLE}>Season</div>
        <select
          value={seasonValue}
          onChange={(event) => updateParams({ season: event.target.value })}
          style={{
            width: "100%",
            borderRadius: 12,
            border: "1px solid #213547",
            background: "#0f1823",
            color: "#e8f5ff",
            padding: "10px 12px",
            fontSize: 14,
            outline: "none",
            fontFamily: "'Barlow Condensed',sans-serif",
          }}
        >
          {seasonOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div
        style={{
          display: "grid",
          gap: 6,
          minWidth: 180,
        }}
      >
        <div style={LABEL_STYLE}>WAR Window</div>
        <select
          value={warModeValue}
          onChange={(event) => updateParams({ war: event.target.value })}
          style={{
            width: "100%",
            borderRadius: 12,
            border: "1px solid #213547",
            background: "#0f1823",
            color: "#e8f5ff",
            padding: "10px 12px",
            fontSize: 14,
            outline: "none",
            fontFamily: "'Barlow Condensed',sans-serif",
          }}
        >
          {warModeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
