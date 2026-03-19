"use client";
import { useState, Fragment } from "react";
import Link from "next/link";

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function toiToSec(toi) {
  if (!toi) return 0;
  const [m, s] = toi.split(":").map(Number);
  return (m || 0) * 60 + (s || 0);
}

function warColor(v) {
  if (v == null) return "#5a7a96";
  return v > 0 ? "#35e3a0" : v < 0 ? "#ff8d9b" : "#8db9dc";
}

function ovrColor(v) {
  if (v == null) return "#5a7a96";
  if (v >= 80) return "#35e3a0";
  if (v >= 60) return "#2fb4ff";
  if (v >= 40) return "#f0c040";
  return "#ff8d9b";
}

const HD = {
  color: "#3d5a75",
  fontSize: 10,
  fontFamily: "'DM Mono',monospace",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  textAlign: "right",
};

const VL = {
  color: "#b8d4e8",
  fontSize: 13,
  fontFamily: "'DM Mono',monospace",
  textAlign: "right",
};

const SKATER_COLS = "minmax(130px,1fr) 44px 36px 24px 24px 30px 28px 28px 28px 44px 36px";
const GOALIE_COLS = "minmax(130px,1fr) 50px 36px 36px 56px 36px";

function SkaterGrid({ players, abbr, color, warMap }) {
  const sorted = [...players].sort((a, b) => toiToSec(b.toi) - toiToSec(a.toi));
  return (
    <div>
      <div style={{ color, fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10, fontWeight: 700 }}>
        {abbr}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: SKATER_COLS, columnGap: 8, rowGap: 5, alignItems: "center" }}>
        <div style={{ ...HD, textAlign: "left" }}>Player</div>
        <div style={HD}>TOI</div>
        <div style={{ ...HD, color }}>Pts</div>
        <div style={HD}>G</div>
        <div style={HD}>A</div>
        <div style={HD}>+/-</div>
        <div style={HD}>SOG</div>
        <div style={HD}>HIT</div>
        <div style={HD}>BLK</div>
        <div style={{ ...HD, color }}>WAR</div>
        <div style={{ ...HD, color }}>OVR</div>
        <div style={{ gridColumn: "1 / -1", height: 1, background: "#141f2d" }} />
        {sorted.map((p) => {
          const pid = String(p.playerId);
          const wData = warMap[pid];
          const war = wData?.war_total ?? null;
          const ovr = wData?.overall_rating ?? null;
          const pm = p.plusMinus ?? 0;
          return (
            <Fragment key={pid}>
              <div style={{ color: "#ddeeff", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <Link href={`/players/${pid}`} style={{ color: "inherit", textDecoration: "none" }}>
                  {p.name?.default ?? "—"}
                </Link>
                <span style={{ color: "#3d5e79", fontSize: 11, fontFamily: "'DM Mono',monospace", marginLeft: 5 }}>
                  {p.position}
                </span>
              </div>
              <div style={{ ...VL, color: "#5a7a96" }}>{p.toi ?? "—"}</div>
              <div style={{ ...VL, color: "#eff8ff", fontWeight: 800 }}>{p.points ?? 0}</div>
              <div style={VL}>{p.goals ?? 0}</div>
              <div style={VL}>{p.assists ?? 0}</div>
              <div style={{ ...VL, color: pm > 0 ? "#35e3a0" : pm < 0 ? "#ff8d9b" : "#8db9dc" }}>
                {pm > 0 ? "+" : ""}{pm}
              </div>
              <div style={VL}>{p.shots ?? 0}</div>
              <div style={VL}>{p.hits ?? 0}</div>
              <div style={VL}>{p.blockedShots ?? 0}</div>
              <div style={{ ...VL, color: warColor(war) }}>
                {war != null ? (war > 0 ? "+" : "") + war.toFixed(1) : "—"}
              </div>
              <div style={{ ...VL, color: ovrColor(ovr) }}>
                {ovr != null ? Math.round(ovr) : "—"}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function GoalieGrid({ goalies, abbr, color }) {
  return (
    <div>
      <div style={{ color, fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10, fontWeight: 700 }}>
        {abbr}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: GOALIE_COLS, columnGap: 8, rowGap: 5, alignItems: "center" }}>
        <div style={{ ...HD, textAlign: "left" }}>Goalie</div>
        <div style={HD}>TOI</div>
        <div style={HD}>SA</div>
        <div style={HD}>SV</div>
        <div style={{ ...HD, color }}>SV%</div>
        <div style={HD}>GA</div>
        <div style={{ gridColumn: "1 / -1", height: 1, background: "#141f2d" }} />
        {goalies.map((p) => {
          const pid = String(p.playerId);
          const sa = p.shotsAgainst ?? 0;
          const sv = p.saves ?? 0;
          const svPct = p.savePctg ?? (sa > 0 ? sv / sa : null);
          const ga = p.goalsAgainst ?? 0;
          return (
            <Fragment key={pid}>
              <div style={{ color: "#ddeeff", fontSize: 13, fontWeight: 700 }}>
                <Link href={`/players/${pid}`} style={{ color: "inherit", textDecoration: "none" }}>
                  {p.name?.default ?? "—"}
                </Link>
              </div>
              <div style={{ ...VL, color: "#5a7a96" }}>{p.toi ?? "—"}</div>
              <div style={VL}>{sa}</div>
              <div style={VL}>{sv}</div>
              <div style={{ ...VL, color }}>
                {svPct != null ? "." + Math.round(svPct * 1000).toString().padStart(3, "0") : "—"}
              </div>
              <div style={{ ...VL, color: ga === 0 ? "#35e3a0" : "#ff8d9b" }}>{ga}</div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default function BoxscorePanel({ homeAbbr, awayAbbr, homeColor, awayColor, playerByGameStats, warMap }) {
  const [tab, setTab] = useState("forwards");
  const away = playerByGameStats?.awayTeam;
  const home = playerByGameStats?.homeTeam;

  const TABS = [
    { key: "forwards", label: "Forwards" },
    { key: "defence", label: "Defence" },
    { key: "goalies", label: "Goalies" },
  ];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "6px 16px",
              borderRadius: 999,
              border: tab === t.key ? "1px solid #2fb4ff" : "1px solid #1e3349",
              background: tab === t.key ? "rgba(47,180,255,0.14)" : "transparent",
              color: tab === t.key ? "#9fd8ff" : "#4a6a88",
              fontSize: 11,
              fontFamily: "'DM Mono',monospace",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== "goalies" && (
        <div style={{ display: "grid", gap: 16 }}>
          {away && (
            <div style={{ borderRadius: 20, border: `1px solid ${hexToRgba(awayColor, 0.28)}`, background: "#091017", padding: "16px 20px" }}>
              <SkaterGrid
                players={tab === "forwards" ? (away.forwards || []) : (away.defense || [])}
                abbr={awayAbbr}
                color={awayColor}
                warMap={warMap}
              />
            </div>
          )}
          {home && (
            <div style={{ borderRadius: 20, border: `1px solid ${hexToRgba(homeColor, 0.28)}`, background: "#091017", padding: "16px 20px" }}>
              <SkaterGrid
                players={tab === "forwards" ? (home.forwards || []) : (home.defense || [])}
                abbr={homeAbbr}
                color={homeColor}
                warMap={warMap}
              />
            </div>
          )}
        </div>
      )}

      {tab === "goalies" && (
        <div style={{ display: "grid", gap: 16 }}>
          {(away?.goalies?.length ?? 0) > 0 && (
            <div style={{ borderRadius: 20, border: `1px solid ${hexToRgba(awayColor, 0.28)}`, background: "#091017", padding: "16px 20px" }}>
              <GoalieGrid goalies={away.goalies} abbr={awayAbbr} color={awayColor} />
            </div>
          )}
          {(home?.goalies?.length ?? 0) > 0 && (
            <div style={{ borderRadius: 20, border: `1px solid ${hexToRgba(homeColor, 0.28)}`, background: "#091017", padding: "16px 20px" }}>
              <GoalieGrid goalies={home.goalies} abbr={homeAbbr} color={homeColor} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
