"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const LABEL_STYLE = {
  color: "#5a7a99",
  fontSize: 10,
  fontFamily: "'DM Mono',monospace",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

function getClosedLabel(selectedSeasons, seasonOptions) {
  if (selectedSeasons.length === 1) {
    return seasonOptions.find((option) => option.value === selectedSeasons[0])?.shortLabel || "1 season selected";
  }
  if (selectedSeasons.length <= 2) {
    return selectedSeasons
      .map((season) => seasonOptions.find((option) => option.value === season)?.shortLabel || season)
      .join(", ");
  }
  return `${selectedSeasons.length} seasons selected`;
}

export default function TeamsSeasonFilter({ seasonOptions, selectedSeasons }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [localSelections, setLocalSelections] = useState(selectedSeasons);
  const rootRef = useRef(null);

  useEffect(() => {
    setLocalSelections(selectedSeasons);
  }, [selectedSeasons]);

  const closedLabel = useMemo(
    () => getClosedLabel(localSelections, seasonOptions),
    [localSelections, seasonOptions]
  );

  useEffect(() => {
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function persistSelections(nextSeasons) {
    const normalized = seasonOptions
      .map((option) => option.value)
      .filter((season) => nextSeasons.includes(season));

    if (!normalized.length) return;

    setLocalSelections(normalized);

    const params = new URLSearchParams(searchParams?.toString() || "");
    params.delete("season");
    params.delete("war");
    params.set("seasons", normalized.join(","));

    const query = params.toString();
    router.replace(query ? `/teams?${query}` : "/teams");
  }

  function toggleSeason(season) {
    const next = localSelections.includes(season)
      ? localSelections.filter((value) => value !== season)
      : [...localSelections, season];

    if (!next.length) return;
    persistSelections(next);
  }

  return (
    <div
      ref={rootRef}
      style={{
        display: "grid",
        gap: 6,
        minWidth: 260,
        position: "relative",
      }}
    >
      <div style={LABEL_STYLE}>Included Seasons</div>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width: "100%",
          borderRadius: 12,
          border: "1px solid #213547",
          background: "#0f1823",
          color: "#e8f5ff",
          padding: "10px 12px",
          fontSize: 14,
          fontFamily: "'Barlow Condensed',sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span>{closedLabel}</span>
        <span style={{ color: "#6d8ba8", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Included seasons"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 8,
            borderRadius: 14,
            border: "1px solid #1d3248",
            background: "#0b131d",
            boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
            padding: 10,
            zIndex: 30,
            display: "grid",
            gap: 6,
          }}
        >
          {seasonOptions.map((option) => {
            const checked = localSelections.includes(option.value);
            const disabled = checked && localSelections.length === 1;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => !disabled && toggleSeason(option.value)}
                disabled={disabled}
                role="option"
                aria-selected={checked}
                style={{
                  borderRadius: 10,
                  border: checked ? "1px solid #315574" : "1px solid transparent",
                  background: checked ? "#102131" : "transparent",
                  color: disabled ? "#4d6a85" : checked ? "#e8f5ff" : "#9ab7d0",
                  padding: "10px 12px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: disabled ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  fontFamily: "'Barlow Condensed',sans-serif",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
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
                </span>
                {disabled ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: "'DM Mono',monospace",
                      color: "#4d6a85",
                      textTransform: "uppercase",
                    }}
                  >
                    Required
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
