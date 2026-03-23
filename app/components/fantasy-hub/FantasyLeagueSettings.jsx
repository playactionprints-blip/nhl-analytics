/**
 * League settings form for the Fantasy Hub.
 * Depends on the persisted fantasy state and updates scoring weights plus
 * roster-slot settings used by rankings and My Team.
 */
const SECTION_STYLE = {
  borderRadius: 20,
  border: "1px solid #17283b",
  background: "#091017",
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
  background: "#0f1823",
  color: "#e8f5ff",
  padding: "10px 12px",
  fontSize: 14,
  outline: "none",
};

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
        border: "1px solid #17283b",
        background: "#0d1620",
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

  return (
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
                  background: state.settings.leagueType === value ? "rgba(47,180,255,0.14)" : "#0d1620",
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
        <div style={{ color: "#eff8ff", fontSize: 18, fontWeight: 900 }}>League settings</div>

        {pointsMode ? (
          <>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={LABEL_STYLE}>Skater scoring</div>
              <div className="fantasy-settings-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                <WeightInput label="Goals" path={["settings", "skaterWeights", "goals"]} value={state.settings.skaterWeights.goals} onUpdate={update} />
                <WeightInput label="Assists" path={["settings", "skaterWeights", "assists"]} value={state.settings.skaterWeights.assists} onUpdate={update} />
                <WeightInput label="Shots" path={["settings", "skaterWeights", "shots"]} value={state.settings.skaterWeights.shots} onUpdate={update} />
                <WeightInput label="Hits" path={["settings", "skaterWeights", "hits"]} value={state.settings.skaterWeights.hits} onUpdate={update} />
                <WeightInput label="Blocks" path={["settings", "skaterWeights", "blocks"]} value={state.settings.skaterWeights.blocks} onUpdate={update} />
                <WeightInput label="PPP" path={["settings", "skaterWeights", "ppp"]} value={state.settings.skaterWeights.ppp} onUpdate={update} />
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={LABEL_STYLE}>Goalie scoring</div>
              <div className="fantasy-settings-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                <WeightInput label="Wins" path={["settings", "goalieWeights", "wins"]} value={state.settings.goalieWeights.wins} onUpdate={update} />
                <WeightInput label="Saves" path={["settings", "goalieWeights", "saves"]} value={state.settings.goalieWeights.saves} onUpdate={update} />
                <WeightInput label="Goals Against" path={["settings", "goalieWeights", "goalsAgainst"]} value={state.settings.goalieWeights.goalsAgainst} onUpdate={update} />
                <WeightInput label="Shutouts" path={["settings", "goalieWeights", "shutouts"]} value={state.settings.goalieWeights.shutouts} onUpdate={update} />
              </div>
            </div>
          </>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={LABEL_STYLE}>Tracked Categories</div>
            <div className="fantasy-settings-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              <ToggleInput label="Goals" path={["settings", "categoryWeights", "goals"]} checked={state.settings.categoryWeights.goals} onUpdate={update} />
              <ToggleInput label="Assists" path={["settings", "categoryWeights", "assists"]} checked={state.settings.categoryWeights.assists} onUpdate={update} />
              <ToggleInput label="Shots" path={["settings", "categoryWeights", "shots"]} checked={state.settings.categoryWeights.shots} onUpdate={update} />
              <ToggleInput label="Hits" path={["settings", "categoryWeights", "hits"]} checked={state.settings.categoryWeights.hits} onUpdate={update} />
              <ToggleInput label="Blocks" path={["settings", "categoryWeights", "blocks"]} checked={state.settings.categoryWeights.blocks} onUpdate={update} />
              <ToggleInput label="PPP" path={["settings", "categoryWeights", "ppp"]} checked={state.settings.categoryWeights.ppp} onUpdate={update} />
              <ToggleInput label="Wins" path={["settings", "categoryWeights", "wins"]} checked={state.settings.categoryWeights.wins} onUpdate={update} />
              <ToggleInput label="Saves" path={["settings", "categoryWeights", "saves"]} checked={state.settings.categoryWeights.saves} onUpdate={update} />
              <ToggleInput label="Save %" path={["settings", "categoryWeights", "savePct"]} checked={state.settings.categoryWeights.savePct} onUpdate={update} />
              <ToggleInput label="GAA" path={["settings", "categoryWeights", "gaa"]} checked={state.settings.categoryWeights.gaa} onUpdate={update} />
            </div>
          </div>
        )}
      </div>

      <div style={SECTION_STYLE}>
        <div style={{ color: "#eff8ff", fontSize: 18, fontWeight: 900 }}>Roster slots</div>
        <div className="fantasy-settings-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          <WeightInput label="Forwards" path={["settings", "rosterSlots", "forwards"]} value={state.settings.rosterSlots.forwards} step="1" onUpdate={update} />
          <WeightInput label="Defense" path={["settings", "rosterSlots", "defense"]} value={state.settings.rosterSlots.defense} step="1" onUpdate={update} />
          <WeightInput label="Goalies" path={["settings", "rosterSlots", "goalies"]} value={state.settings.rosterSlots.goalies} step="1" onUpdate={update} />
          <WeightInput label="Bench" path={["settings", "rosterSlots", "bench"]} value={state.settings.rosterSlots.bench} step="1" onUpdate={update} />
          <WeightInput label="IR" path={["settings", "rosterSlots", "ir"]} value={state.settings.rosterSlots.ir} step="1" onUpdate={update} />
        </div>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .fantasy-settings-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
