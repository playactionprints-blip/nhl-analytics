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

const SKATER_COLS = "minmax(130px,1fr) 44px 36px 24px 24px 30px 28px 28px 28px 36px 40px 36px";
const GOALIE_COLS = "minmax(130px,1fr) 50px 36px 36px 56px 36px";

function SkaterGrid({ players, abbr, color, playerXGMap }) {
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
        <div style={{ ...HD, color }}>xG</div>
        <div style={{ ...HD, color }}>xG/60</div>
        <div style={HD}>SH%</div>
        <div style={{ gridColumn: "1 / -1", height: 1, background: "#141f2d" }} />
        {sorted.map((p) => {
          const pid = String(p.playerId);
          const pm = p.plusMinus ?? 0;
          const shots = p.shots ?? 0;
          const goals = p.goals ?? 0;
          const toiSec = toiToSec(p.toi);
          const xgEntry = playerXGMap?.[pid];
          const xg = xgEntry?.xg ?? null;
          const xgPer60 = xg != null && toiSec > 0 ? (xg / toiSec) * 3600 : null;
          const shPct = shots > 0 ? ((goals / shots) * 100).toFixed(1) + "%" : "—";
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
              <div style={{ ...VL, color: "var(--text-primary)", fontWeight: 800 }}>{p.points ?? 0}</div>
              <div style={VL}>{goals}</div>
              <div style={VL}>{p.assists ?? 0}</div>
              <div style={{ ...VL, color: pm > 0 ? "#35e3a0" : pm < 0 ? "#ff8d9b" : "#8db9dc" }}>
                {pm > 0 ? "+" : ""}{pm}
              </div>
              <div style={VL}>{shots}</div>
              <div style={VL}>{p.hits ?? 0}</div>
              <div style={VL}>{p.blockedShots ?? 0}</div>
              <div style={{ ...VL, color: "#9fd8ff" }}>
                {xg != null ? xg.toFixed(2) : "—"}
              </div>
              <div style={{ ...VL, color: "#9fd8ff" }}>
                {xgPer60 != null ? xgPer60.toFixed(2) : "—"}
              </div>
              <div style={VL}>{shPct}</div>
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

export default function BoxscorePanel({ homeAbbr, awayAbbr, homeColor, awayColor, playerByGameStats, playerXGMap = {} }) {
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
      <div className="boxscore-tab-row" style={{ display: "flex", gap: 8 }}>
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
            <div className="boxscore-team-card" style={{ borderRadius: 20, border: `1px solid ${hexToRgba(awayColor, 0.28)}`, background: "var(--bg-card)", padding: "16px 20px" }}>
              <SkaterGrid
                players={tab === "forwards" ? (away.forwards || []) : (away.defense || [])}
                abbr={awayAbbr}
                color={awayColor}
                playerXGMap={playerXGMap}
              />
            </div>
          )}
          {home && (
            <div className="boxscore-team-card" style={{ borderRadius: 20, border: `1px solid ${hexToRgba(homeColor, 0.28)}`, background: "var(--bg-card)", padding: "16px 20px" }}>
              <SkaterGrid
                players={tab === "forwards" ? (home.forwards || []) : (home.defense || [])}
                abbr={homeAbbr}
                color={homeColor}
                playerXGMap={playerXGMap}
              />
            </div>
          )}
        </div>
      )}

      {tab === "goalies" && (
        <div style={{ display: "grid", gap: 16 }}>
          {(away?.goalies?.length ?? 0) > 0 && (
            <div className="boxscore-team-card" style={{ borderRadius: 20, border: `1px solid ${hexToRgba(awayColor, 0.28)}`, background: "var(--bg-card)", padding: "16px 20px" }}>
              <GoalieGrid goalies={away.goalies} abbr={awayAbbr} color={awayColor} />
            </div>
          )}
          {(home?.goalies?.length ?? 0) > 0 && (
            <div className="boxscore-team-card" style={{ borderRadius: 20, border: `1px solid ${hexToRgba(homeColor, 0.28)}`, background: "var(--bg-card)", padding: "16px 20px" }}>
              <GoalieGrid goalies={home.goalies} abbr={homeAbbr} color={homeColor} />
            </div>
          )}
        </div>
      )}

      <style>{`
        .boxscore-tab-row {
          flex-wrap: wrap;
        }
        .boxscore-team-card {
          overflow-x: auto;
        }
        @media (max-width: 640px) {
          .boxscore-team-card {
            padding: 14px 14px !important;
          }
          .boxscore-tab-row {
            gap: 6px;
          }
          .boxscore-tab-row button {
            min-height: 40px;
            padding: 8px 14px !important;
          }
        }
      `}</style>
    </div>
  );
}
