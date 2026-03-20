"use client";
import { useState } from "react";

export default function ShareButton({ playerId }) {
  const [copied, setCopied] = useState(false);

  function handleClick() {
    const url = `${window.location.origin}/api/og/player?id=${playerId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      onClick={handleClick}
      style={{
        fontSize: 10,
        color: copied ? "#2fb4ff" : "#4a7fa5",
        fontFamily: "'DM Mono',monospace",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        padding: "4px 8px",
        border: `1px solid ${copied ? "#2fb4ff" : "#1e3048"}`,
        borderRadius: 6,
        background: "transparent",
        cursor: "pointer",
        transition: "color 0.15s, border-color 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!copied) {
          e.currentTarget.style.borderColor = "#2fb4ff";
          e.currentTarget.style.color = "#9fd8ff";
        }
      }}
      onMouseLeave={(e) => {
        if (!copied) {
          e.currentTarget.style.borderColor = "#1e3048";
          e.currentTarget.style.color = "#4a7fa5";
        }
      }}
    >
      {copied ? "Copied!" : "Share Card ↗"}
    </button>
  );
}
