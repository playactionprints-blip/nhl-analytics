/**
 * Shared shell and tabbed layout for the Fantasy Hub.
 * Depends on child sections provided by the main fantasy client app.
 */
import { FANTASY_TABS } from "@/app/components/fantasy-hub/fantasyHubConfig";

export default function FantasyHubLayout({ activeTab, onTabChange, header, contextBar, children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top left, #0d2136 0%, var(--bg-primary) 58%, var(--bg-primary) 100%)",
        padding: "28px 16px 52px",
      }}
    >
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gap: 16 }}>
        {header}
        {contextBar}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {FANTASY_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              style={{
                borderRadius: 999,
                border: `1px solid ${activeTab === tab.key ? "#2fb4ff" : "#20374d"}`,
                background: activeTab === tab.key ? "rgba(47,180,255,0.16)" : "#111a23",
                color: activeTab === tab.key ? "#cfeeff" : "#8ca8c1",
                fontWeight: 800,
                fontSize: 12,
                padding: "10px 14px",
                cursor: "pointer",
                fontFamily: "'DM Mono',monospace",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {children}
      </div>
    </div>
  );
}
