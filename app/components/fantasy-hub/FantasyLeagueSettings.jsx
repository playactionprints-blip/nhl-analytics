/**
 * League settings form for the Fantasy Hub.
 * Depends on the persisted fantasy state and updates scoring weights plus
 * roster-slot settings used by rankings and My Team.
 */
"use client";

import { useMemo, useState } from "react";

const COLLAPSE_STORAGE_KEY = "nhl-analytics:fantasy-hub:settings-collapsed";

const SECTION_STYLE = {
  borderRadius: 20,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-card)",
  padding: "16px 16px 14px",
  display: "grid",
  gap: 14,
};

const LABEL_STYLE = {
  color: "#7d95ab",
  fontSize: 11,
  fontFamily: "'DM Mono',monospace",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const INPUT_STYLE = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid #213547",
  background: "var(--bg-card)",
  color: "#e8f5ff",
  padding: "10px 12px",
  fontSize: 14,
  outline: "none",
};

const POINTS_SECTION_CONFIG = [
  {
    title: "Skater Scoring",
    fields: [
      { label: "Goals", path: ["settings", "skaterWeights", "goals"] },
      { label: "Assists", path: ["settings", "skaterWeights", "assists"] },
      { label: "PPP", path: ["settings", "skaterWeights", "ppp"] },
      { label: "SHP", path: ["settings", "skaterWeights", "shp"] },
    ],
  },
  {
    title: "Shots & Efficiency",
    fields: [{ label: "Shots", path: ["settings", "skaterWeights", "shots"] }],
  },
  {
    title: "Physical Stats",
    fields: [
      { label: "Hits", path: ["settings", "skaterWeights", "hits"] },
      { label: "Blocks", path: ["settings", "skaterWeights", "blocks"] },
      { label: "Takeaways", path: ["settings", "skaterWeights", "takeaways"] },
      { label: "Giveaways", path: ["settings", "skaterWeights", "giveaways"] },
    ],
  },
  {
    title: "Faceoffs",
    fields: [
      { label: "FOL", path: ["settings", "skaterWeights", "fol"] },
      { label: "FW%", path: ["settings", "skaterWeights", "fwPct"], step: "0.01" },
    ],
  },
  {
    title: "Advanced",
    collapsible: true,
    fields: [
      { label: "TOI", path: ["settings", "skaterWeights", "toi"] },
      { label: "PP TOI", path: ["settings", "skaterWeights", "ppToi"] },
    ],
  },
  {
    title: "Goalie Stats",
    fields: [
      { label: "Wins", path: ["settings", "goalieWeights", "wins"] },
      { label: "Saves", path: ["settings", "goalieWeights", "saves"] },
      { label: "Goals Against", path: ["settings", "goalieWeights", "goalsAgainst"] },
      { label: "Shutouts", path: ["settings", "goalieWeights", "shutouts"] },
      { label: "SV%", path: ["settings", "goalieWeights", "savePct"], step: "0.01" },
      { label: "GAA", path: ["settings", "goalieWeights", "gaa"], step: "0.01" },
      { label: "Quality Starts", path: ["settings", "goalieWeights", "qualityStarts"] },
      { label: "Shots Against", path: ["settings", "goalieWeights", "shotsAgainst"] },
    ],
  },
];

const CATEGORY_SECTION_CONFIG = [
  {
    title: "Skater Scoring",
    fields: [
      { label: "Goals", path: ["settings", "categoryWeights", "goals"] },
      { label: "Assists", path: ["settings", "categoryWeights", "assists"] },
      { label: "PPP", path: ["settings", "categoryWeights", "ppp"] },
      { label: "SHP", path: ["settings", "categoryWeights", "shp"] },
    ],
  },
  {
    title: "Shots & Efficiency",
    fields: [{ label: "Shots", path: ["settings", "categoryWeights", "shots"] }],
  },
  {
    title: "Physical Stats",
    fields: [
      { label: "Hits", path: ["settings", "categoryWeights", "hits"] },
      { label: "Blocks", path: ["settings", "categoryWeights", "blocks"] },
      { label: "Takeaways", path: ["settings", "categoryWeights", "takeaways"] },
      { label: "Giveaways", path: ["settings", "categoryWeights", "giveaways"] },
    ],
  },
  {
    title: "Faceoffs",
    fields: [
      { label: "FOL", path: ["settings", "categoryWeights", "fol"] },
      { label: "FW%", path: ["settings", "categoryWeights", "fwPct"] },
    ],
  },
  {
    title: "Advanced",
    collapsible: true,
    fields: [
      { label: "TOI", path: ["settings", "categoryWeights", "toi"] },
      { label: "PP TOI", path: ["settings", "categoryWeights", "ppToi"] },
    ],
  },
  {
    title: "Goalie Stats",
    fields: [
      { label: "Wins", path: ["settings", "categoryWeights", "wins"] },
      { label: "Saves", path: ["settings", "categoryWeights", "saves"] },
      { label: "Save %", path: ["settings", "categoryWeights", "savePct"] },
      { label: "GAA", path: ["settings", "categoryWeights", "gaa"] },
      { label: "Quality Starts", path: ["settings", "categoryWeights", "qualityStarts"] },
      { label: "Shots Against", path: ["settings", "categoryWeights", "shotsAgainst"] },
    ],
  },
];

function WeightInput({ label, path, value, onUpdate, step = "0.1" }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={LABEL_STYLE}>{label}</div>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => onUpdate(path, Number(event.target.value))}
        style={INPUT_STYLE}
      />
    </div>
  );
}

function ToggleInput({ label, path, checked, onUpdate }) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        borderRadius: 14,
        border: "1px solid var(--border-strong)",
        background: "var(--bg-card)",
        padding: "10px 12px",
      }}
    >
      <span style={{ color: "#dcecf9", fontSize: 14, fontWeight: 700 }}>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onUpdate(path, event.target.checked)}
        style={{ width: 18, height: 18 }}
      />
    </label>
  );
}

export default function FantasyLeagueSettings({ state, onStateChange }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      if (typeof window === "undefined") return false;
      const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      return raw === "true";
    } catch {
      return false;
    }
  });

  function update(path, value) {
    onStateChange((current) => {
      const next = JSON.parse(JSON.stringify(current));
      let target = next;
      for (let index = 0; index < path.length - 1; index += 1) {
        target = target[path[index]];
      }
      target[path[path.length - 1]] = value;
      return next;
    });
  }

  const pointsMode = state.settings.leagueType === "points";
  const rosterSlotSummary = useMemo(() => {
    const slots = state.settings.rosterSlots;
    return `F ${slots.forwards} · D ${slots.defense} · G ${slots.goalies} · BN ${slots.bench}${slots.ir ? ` · IR ${slots.ir}` : ""}`;
  }, [state.settings.rosterSlots]);

  function renderField(field, type = "weight") {
    if (type === "toggle") {
      return (
        <ToggleInput
          key={field.path.join(".")}
          label={field.label}
          path={field.path}
          checked={state.settings.categoryWeights[field.path[field.path.length - 1]]}
          onUpdate={update}
        />
      );
    }

    return (
      <WeightInput
        key={field.path.join(".")}
        label={field.label}
        path={field.path}
        value={state.settings[field.path[1]][field.path[2]]}
        onUpdate={update}
        step={field.step || "0.1"}
      />
    );
  }

  function renderSettingsSection(section, type = "weight") {
    const isCollapsedSection = section.collapsible && !advancedOpen;
    return (
      <div key={section.title} style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={LABEL_STYLE}>{section.title}</div>
          {section.collapsible ? (
            <button
              type="button"
              onClick={() => setAdvancedOpen((current) => !current)}
              style={{
                borderRadius: 999,
                border: `1px solid ${advancedOpen ? "#2fb4ff" : "#213547"}`,
                background: advancedOpen ? "rgba(47,180,255,0.14)" : "var(--bg-card)",
                color: advancedOpen ? "#d6f0ff" : "#8ca8c1",
                padding: "7px 10px",
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontFamily: "'DM Mono',monospace",
                cursor: "pointer",
              }}
            >
              {advancedOpen ? "Hide" : "Show"}
            </button>
          ) : null}
        </div>
        {!isCollapsedSection ? (
          <div className="fantasy-settings-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            {section.fields.map((field) => renderField(field, type))}
          </div>
        ) : (
          <div
            style={{
              borderRadius: 14,
              border: "1px dashed #29445b",
              background: "rgba(13,22,32,0.6)",
              padding: "10px 12px",
              color: "#7d95ab",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            Expand this section for advanced usage and efficiency weights.
          </div>
        )}
      </div>
    );
  }

  function handleToggle() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      } catch {
        // Ignore localStorage write failures.
      }
      return next;
    });
  }

  return (
    <section
      style={{
        borderRadius: 24,
        border: "1px solid #214361",
        background: "linear-gradient(180deg, rgba(10,20,32,0.98) 0%, rgba(7,11,18,0.98) 100%)",
        boxShadow: "0 0 0 1px rgba(47,180,255,0.08), 0 18px 42px rgba(0,0,0,0.22)",
        padding: "18px 18px 16px",
        display: "grid",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 8, maxWidth: 740 }}>
          <div style={{ color: "#6caede", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            Step 1: Configure Your League
          </div>
          <div style={{ color: "var(--text-primary)", fontSize: 28, fontWeight: 900, lineHeight: 1.05 }}>
            League settings
          </div>
          <div style={{ color: "#86a5c0", fontSize: 14, lineHeight: 1.6 }}>
            Your scoring settings determine rankings and player values. Set your format first so the rest of Fantasy Hub reflects your real league.
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggle}
          style={{
            borderRadius: 999,
            border: `1px solid ${collapsed ? "#213547" : "#2fb4ff"}`,
            background: collapsed ? "var(--bg-card)" : "rgba(47,180,255,0.14)",
            color: collapsed ? "#8ca8c1" : "#d6f0ff",
            padding: "10px 14px",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontFamily: "'DM Mono',monospace",
            cursor: "pointer",
          }}
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      <div className="fantasy-league-overview-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        <div style={{ borderRadius: 16, border: "1px solid #1b3347", background: "#0c141d", padding: "12px 12px 10px", display: "grid", gap: 6 }}>
          <div style={LABEL_STYLE}>League Type</div>
          <div style={{ color: "var(--text-primary)", fontSize: 18, fontWeight: 900 }}>
            {pointsMode ? "Points League" : "Categories League"}
          </div>
        </div>
        <div style={{ borderRadius: 16, border: "1px solid #1b3347", background: "#0c141d", padding: "12px 12px 10px", display: "grid", gap: 6 }}>
          <div style={LABEL_STYLE}>Roster Slots</div>
          <div style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 900 }}>
            {rosterSlotSummary}
          </div>
        </div>
        <div style={{ borderRadius: 16, border: "1px solid #1b3347", background: "#0c141d", padding: "12px 12px 10px", display: "grid", gap: 6 }}>
          <div style={LABEL_STYLE}>Scoring Focus</div>
          <div style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 900 }}>
            {pointsMode ? "Weighted fantasy points" : "Category win volume"}
          </div>
        </div>
      </div>

      {!collapsed ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={SECTION_STYLE}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={LABEL_STYLE}>Team Identity</div>
          <input
            type="text"
            value={state.teamName}
            onChange={(event) => update(["teamName"], event.target.value)}
            style={INPUT_STYLE}
            placeholder="My Fantasy Team"
          />
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={LABEL_STYLE}>League Type</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              ["points", "Points League"],
              ["categories", "Categories League"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => update(["settings", "leagueType"], value)}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${state.settings.leagueType === value ? "#2fb4ff" : "#213547"}`,
                  background: state.settings.leagueType === value ? "rgba(47,180,255,0.14)" : "var(--bg-card)",
                  color: state.settings.leagueType === value ? "#d6f0ff" : "#8ca8c1",
                  padding: "9px 12px",
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  fontFamily: "'DM Mono',monospace",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={SECTION_STYLE}>
        <div style={{ color: "var(--text-primary)", fontSize: 18, fontWeight: 900 }}>League settings</div>

        {pointsMode ? (
          <>
            {POINTS_SECTION_CONFIG.map((section) => renderSettingsSection(section, "weight"))}
          </>
        ) : (
          CATEGORY_SECTION_CONFIG.map((section) => renderSettingsSection(section, "toggle"))
        )}
      </div>

      <div style={SECTION_STYLE}>
        <div style={{ color: "var(--text-primary)", fontSize: 18, fontWeight: 900 }}>Roster slots</div>
        <div className="fantasy-settings-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          <WeightInput label="Forwards" path={["settings", "rosterSlots", "forwards"]} value={state.settings.rosterSlots.forwards} step="1" onUpdate={update} />
          <WeightInput label="Defense" path={["settings", "rosterSlots", "defense"]} value={state.settings.rosterSlots.defense} step="1" onUpdate={update} />
          <WeightInput label="Goalies" path={["settings", "rosterSlots", "goalies"]} value={state.settings.rosterSlots.goalies} step="1" onUpdate={update} />
          <WeightInput label="Bench" path={["settings", "rosterSlots", "bench"]} value={state.settings.rosterSlots.bench} step="1" onUpdate={update} />
          <WeightInput label="IR" path={["settings", "rosterSlots", "ir"]} value={state.settings.rosterSlots.ir} step="1" onUpdate={update} />
        </div>
      </div>
        </div>
      ) : (
        <div
          style={{
            borderRadius: 18,
            border: "1px dashed #29445b",
            background: "rgba(13,22,32,0.78)",
            padding: "14px 16px",
            color: "#7d95ab",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          League setup is collapsed. Expand it any time to update scoring weights, category toggles, or roster slots.
        </div>
      )}

      <style>{`
        @media (max-width: 640px) {
          .fantasy-league-overview-grid,
          .fantasy-settings-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
