"use client";

import { useState } from "react";
import Link from "next/link";
import { PlayerCard } from "@/PlayerCard";
import { GoalieCard } from "@/GoalieCard";
import { BreadcrumbSetter } from "@/Breadcrumbs";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ReferenceLine,
} from "recharts";

// ── Shared constants (mirrored from PlayerCard.jsx) ──────────────────────────
const TEAM_COLOR = {
  ANA:"#F47A38",BOS:"#FFB81C",BUF:"#003087",CAR:"#CC0000",
  CBJ:"#002654",CGY:"#C8102E",CHI:"#CF0A2C",COL:"#6F263D",DAL:"#006847",
  DET:"#CE1126",EDM:"#FF4C00",FLA:"#C8102E",LAK:"#111111",MIN:"#154734",
  MTL:"#AF1E2D",NSH:"#FFB81C",NJD:"#CC0000",NYI:"#00539B",NYR:"#0038A8",
  OTT:"#C52032",PHI:"#F74902",PIT:"#CFC493",SEA:"#99D9D9",SJS:"#006D75",
  STL:"#002F87",TBL:"#002868",TOR:"#00205B",UTA:"#69B3E7",VAN:"#00843D",
  VGK:"#B4975A",WPG:"#041E42",WSH:"#C8102E",
};

const TEAM_FULL = {
  ANA:"Anaheim Ducks",BOS:"Boston Bruins",BUF:"Buffalo Sabres",
  CAR:"Carolina Hurricanes",CBJ:"Columbus Blue Jackets",CGY:"Calgary Flames",
  CHI:"Chicago Blackhawks",COL:"Colorado Avalanche",DAL:"Dallas Stars",
  DET:"Detroit Red Wings",EDM:"Edmonton Oilers",FLA:"Florida Panthers",
  LAK:"Los Angeles Kings",MIN:"Minnesota Wild",MTL:"Montréal Canadiens",
  NSH:"Nashville Predators",NJD:"New Jersey Devils",NYI:"New York Islanders",
  NYR:"New York Rangers",OTT:"Ottawa Senators",PHI:"Philadelphia Flyers",
  PIT:"Pittsburgh Penguins",SEA:"Seattle Kraken",SJS:"San Jose Sharks",
  STL:"St. Louis Blues",TBL:"Tampa Bay Lightning",TOR:"Toronto Maple Leafs",
  UTA:"Utah Hockey Club",VAN:"Vancouver Canucks",VGK:"Vegas Golden Knights",
  WPG:"Winnipeg Jets",WSH:"Washington Capitals",
};

function logoUrl(abbr) {
  return `https://assets.nhle.com/logos/nhl/svg/${abbr}_light.svg`;
}

function pctColor(v) {
  if (v >= 85) return "#00e5a0";
  if (v >= 70) return "#f0c040";
  if (v >= 50) return "#f08040";
  return "#e05050";
}

function ratingBadge(v) {
  if (v == null) return null;
  const r = Math.round(v);
  const bg = v >= 85 ? "#00e5a044" : v >= 70 ? "#f0c04044" : v >= 50 ? "#f0804044" : "#e0505044";
  const border = v >= 85 ? "#00e5a0" : v >= 70 ? "#f0c040" : v >= 50 ? "#f08040" : "#e05050";
  const color  = v >= 85 ? "#00e5a0" : v >= 70 ? "#f0c040" : v >= 50 ? "#f08040" : "#e05050";
  return { r, bg, border, color };
}

function diffColor(diff) {
  if (diff > 0.5)  return "#00e5a0";
  if (diff > -0.5) return "#f0c040";
  return "#e05050";
}

// ── Team Logo with img fallback ───────────────────────────────────────────────
function TeamLogo({ abbr, size = 80 }) {
  const [failed, setFailed] = useState(false);
  const color = TEAM_COLOR[abbr] || "#4a6a88";
  if (failed) {
    return (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.28, fontWeight: 900, color, fontFamily: "'Barlow Condensed',sans-serif" }}>
        {abbr}
      </div>
    );
  }
  return (
    <img src={logoUrl(abbr)} alt={abbr} width={size} height={size}
      style={{ objectFit: "contain" }}
      onError={() => setFailed(true)} />
  );
}

// ── Player avatar (40px headshot with fallback initials) ─────────────────────
function MiniAvatar({ player }) {
  const [failed, setFailed] = useState(false);
  const color = TEAM_COLOR[player.team] || "#4a6a88";
  const initials = `${(player.first_name || "?")[0]}${(player.last_name || "?")[0]}`;
  if (!failed && player.headshot_url) {
    return (
      <div style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden",
        border: `1px solid ${color}44`, flexShrink: 0, background: `${color}22` }}>
        <img src={player.headshot_url} alt={player.full_name}
          width={40} height={40} style={{ objectFit: "cover", width: "100%", height: "100%" }}
          onError={() => setFailed(true)} />
      </div>
    );
  }
  return (
    <div style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0,
      background: `linear-gradient(135deg,${color},${color}88)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 13, fontWeight: 900, color: "white", letterSpacing: "-0.5px" }}>
      {initials}
    </div>
  );
}

// ── Stat diff indicator ───────────────────────────────────────────────────────
function StatBox({ label, value, sub, subColor }) {
  return (
    <div style={{ background: "#0d1825", border: "1px solid #1e2d40", borderRadius: 10,
      padding: "14px 18px", textAlign: "center", flex: 1 }}>
      <div style={{ fontSize: 26, fontWeight: 900, color: "#e8f4ff",
        fontFamily: "'Barlow Condensed',sans-serif", lineHeight: 1 }}>
        {value ?? "—"}
      </div>
      <div style={{ fontSize: 10, color: "#5a7a99", marginTop: 4,
        fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      {sub != null && (
        <div style={{ fontSize: 10, color: subColor || "#5a7a99",
          fontFamily: "'DM Mono',monospace", marginTop: 3 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function TeamSeasonTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div style={{
      background: "#09131d",
      border: "1px solid #243445",
      borderRadius: 10,
      padding: "8px 10px",
      boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
    }}>
      <div style={{ fontSize: 11, color: "#a2b5c9", fontFamily: "'DM Mono',monospace", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: "#e8f4ff", fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>
        {formatter(item?.value)}
      </div>
    </div>
  );
}

function SeasonTrendCard({ label, data, dataKey, accent, mutedColor, formatter, showLeagueReference = false }) {
  return (
    <div style={{
      background: "#060b12",
      border: "1px solid #1e2d40",
      borderRadius: 16,
      padding: "16px 18px 14px",
    }}>
      <div style={{
        fontSize: 11,
        color: "#5a7a99",
        fontFamily: "'DM Mono',monospace",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        marginBottom: 12,
      }}>
        {label}
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#122030" vertical={false} />
          <XAxis
            dataKey="season"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#5a7a99", fontFamily: "DM Mono,monospace" }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#5a7a99", fontFamily: "DM Mono,monospace" }}
            width={34}
          />
          {showLeagueReference && (
            <ReferenceLine y={50} stroke="#6a8299" strokeDasharray="4 4" ifOverflow="extendDomain" />
          )}
          <Tooltip content={<TeamSeasonTooltip formatter={formatter} />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
          <Bar dataKey={dataKey} radius={[6, 6, 0, 0]}>
            {data.map((entry) => (
              <Cell
                key={`${entry.season}-${dataKey}`}
                fill={entry.isCurrent ? accent : mutedColor}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Player row ────────────────────────────────────────────────────────────────
function PlayerRow({ player, rank, onSelect }) {
  const [hovered, setHovered] = useState(false);
  const badge = ratingBadge(player.overall_rating);
  const war = player.war_total;

  return (
    <div
      onClick={() => onSelect(player)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "8px 14px",
        background: hovered ? "#0d1825" : rank % 2 === 0 ? "#080e17" : "#060b12",
        borderBottom: "1px solid #0a1218",
        cursor: "pointer", transition: "background 0.15s",
      }}>

      {/* Rank */}
      <div style={{ width: 22, fontSize: 11, color: "#2a4060",
        fontFamily: "'DM Mono',monospace", textAlign: "right", flexShrink: 0 }}>
        {rank}
      </div>

      {/* Avatar */}
      <MiniAvatar player={player} />

      {/* Name + position */}
      <div style={{ flex: "0 0 180px", minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#c8dff0",
          fontFamily: "'Barlow Condensed',sans-serif", whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis" }}>
          {player.full_name}
        </div>
        <div style={{ fontSize: 10, color: "#4a6a88", fontFamily: "'DM Mono',monospace",
          marginTop: 1 }}>
          #{player.jersey ?? "—"} · {player.position}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 16, flex: 1, justifyContent: "flex-end",
        alignItems: "center", flexWrap: "wrap" }}>
        {[
          { label: "GP",  val: player.gp },
          { label: "G",   val: player.g },
          { label: "A",   val: player.a },
          { label: "PTS", val: player.pts, bold: true },
        ].map(({ label, val, bold }) => (
          <div key={label} style={{ textAlign: "center", minWidth: 30 }}>
            <div style={{ fontSize: bold ? 14 : 13, fontWeight: bold ? 700 : 400,
              color: bold ? "#e8f4ff" : "#6a8aaa",
              fontFamily: "'DM Mono',monospace" }}>
              {val ?? "—"}
            </div>
            <div style={{ fontSize: 9, color: "#2a4060",
              fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>
              {label}
            </div>
          </div>
        ))}

        {/* Rating badge */}
        {badge ? (
          <div style={{ background: badge.bg, border: `1px solid ${badge.border}`,
            borderRadius: 6, padding: "3px 8px", minWidth: 38, textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: badge.color,
              fontFamily: "'Barlow Condensed',sans-serif", lineHeight: 1 }}>
              {badge.r}
            </div>
            <div style={{ fontSize: 8, color: badge.color, opacity: 0.7,
              fontFamily: "'DM Mono',monospace", letterSpacing: "0.05em" }}>
              OVR
            </div>
          </div>
        ) : (
          <div style={{ minWidth: 38 }} />
        )}

        {/* WAR */}
        <div style={{ textAlign: "center", minWidth: 36 }}>
          <div style={{ fontSize: 13, fontWeight: 700,
            color: war == null ? "#2a4060" : war > 2 ? "#00e5a0" : war >= 0.5 ? "#f0c040" : "#e05050",
            fontFamily: "'DM Mono',monospace" }}>
            {war != null ? war.toFixed(1) : "—"}
          </div>
          <div style={{ fontSize: 9, color: "#2a4060",
            fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>
            WAR
          </div>
        </div>

        {/* Arrow */}
        <div style={{ fontSize: 12, color: "#1e3348", paddingLeft: 4 }}>›</div>
      </div>
    </div>
  );
}

// ── Modal overlay ─────────────────────────────────────────────────────────────
function PlayerModal({ player, onClose }) {
  if (!player) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}>
      <div onClick={e => e.stopPropagation()}>
        {player.position === "G"
          ? <GoalieCard player={player} />
          : <PlayerCard player={player} />
        }
      </div>
    </div>
  );
}

// ── Main TeamPage component ───────────────────────────────────────────────────
export default function TeamPage({ teamCode, players, record, teamStats, seasonCharts = [] }) {
  const [tab, setTab] = useState("forwards");
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  const color = TEAM_COLOR[teamCode] || "#4a6a88";
  const teamName = TEAM_FULL[teamCode] || teamCode;

  const forwards  = players.filter(p => ["C", "L", "R", "F", "LW", "RW"].includes(p.position));
  const defense   = players.filter(p => p.position === "D");
  const goalies   = players.filter(p => p.position === "G");

  const activeRoster = tab === "forwards" ? forwards : tab === "defense" ? defense : goalies;

  const { avgCF, avgXGF, totalWAR, warRank, ppPct, leagueAvgCF, leagueAvgXGF } = teamStats;

  const cfDiff  = avgCF  != null ? +(avgCF  - (leagueAvgCF  || 50)).toFixed(1) : null;
  const xgfDiff = avgXGF != null ? +(avgXGF - (leagueAvgXGF || 50)).toFixed(1) : null;

  // League avg PP% ~ 20.5%
  const ppDiff = ppPct != null ? +(ppPct - 20.5).toFixed(1) : null;

  function fmtDiff(d) {
    if (d == null) return null;
    return d >= 0 ? `+${d}% vs avg` : `${d}% vs avg`;
  }

  const recordStr = record
    ? `${record.wins}-${record.losses}-${record.otLosses}`
    : null;
  const ptsStr = record ? `${record.points} pts` : null;

  return (
    <>
      <BreadcrumbSetter
        items={[
          { href: "/teams", label: "Teams" },
          { href: `/team/${teamCode}`, label: teamName },
        ]}
      />
      <div style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 20% 20%,#0d1e30 0%,#05090f 60%)",
        padding: "32px 20px 60px",
        fontFamily: "'Barlow Condensed',sans-serif",
      }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>

          {/* Back link */}
          <Link href="/teams" style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 11, color: "#4a6a88", textDecoration: "none",
            fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em",
            textTransform: "uppercase", marginBottom: 24,
          }}>
            ← All Teams
          </Link>

          {/* ── Header ── */}
          <div style={{
            display: "flex", alignItems: "center", gap: 24,
            marginBottom: 28, flexWrap: "wrap",
          }}>
            <div style={{
              background: `linear-gradient(135deg,${color}18,${color}08)`,
              border: `1px solid ${color}33`,
              borderRadius: 16, padding: 16,
              boxShadow: `0 8px 32px ${color}22`,
            }}>
              <TeamLogo abbr={teamCode} size={80} />
            </div>

            <div>
              <div style={{ fontSize: 11, color: color, fontFamily: "'DM Mono',monospace",
                textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 4 }}>
                {teamCode}
              </div>
              <h1 style={{ fontSize: 42, fontWeight: 900, color: "#e8f4ff",
                letterSpacing: "-0.5px", lineHeight: 1, margin: 0 }}>
                {teamName}
              </h1>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6,
                flexWrap: "wrap" }}>
                {recordStr && (
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#8899aa",
                    fontFamily: "'DM Mono',monospace" }}>
                    {recordStr}
                  </span>
                )}
                {ptsStr && (
                  <>
                    <span style={{ color: "#1e2d40" }}>·</span>
                    <span style={{ fontSize: 14, color: "#5a7a99",
                      fontFamily: "'DM Mono',monospace" }}>
                      {ptsStr}
                    </span>
                  </>
                )}
                {warRank && (
                  <>
                    <span style={{ color: "#1e2d40" }}>·</span>
                    <span style={{ fontSize: 12, padding: "2px 8px",
                      background: warRank <= 10 ? "#00e5a022" : "#0d1825",
                      border: `1px solid ${warRank <= 10 ? "#00e5a055" : "#1e2d40"}`,
                      borderRadius: 20, color: warRank <= 10 ? "#00e5a0" : "#4a6a88",
                      fontFamily: "'DM Mono',monospace" }}>
                      WAR Rank #{warRank}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Stats bar ── */}
          <div style={{ display: "flex", gap: 10, marginBottom: 28, flexWrap: "wrap" }}>
            <StatBox
              label="CF% (5v5)"
              value={avgCF != null ? `${avgCF.toFixed(1)}%` : null}
              sub={fmtDiff(cfDiff)}
              subColor={cfDiff != null ? diffColor(cfDiff) : undefined}
            />
            <StatBox
              label="xGF% (5v5)"
              value={avgXGF != null ? `${avgXGF.toFixed(1)}%` : null}
              sub={fmtDiff(xgfDiff)}
              subColor={xgfDiff != null ? diffColor(xgfDiff) : undefined}
            />
            <StatBox
              label="Total WAR"
              value={totalWAR != null ? totalWAR.toFixed(1) : null}
              sub={warRank ? `Rank: #${warRank} of 32` : null}
              subColor={warRank != null ? pctColor(100 - warRank * 3) : undefined}
            />
            <StatBox
              label="PP%"
              value={ppPct != null ? `${ppPct.toFixed(1)}%` : null}
              sub={fmtDiff(ppDiff)}
              subColor={ppDiff != null ? diffColor(ppDiff) : undefined}
            />
          </div>

          {seasonCharts.length > 0 && (
            <div className="team-season-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 24 }}>
              <SeasonTrendCard
                label="WAR · By Season"
                data={seasonCharts}
                dataKey="totalWAR"
                accent="#38bdf8"
                mutedColor="#415468"
                formatter={(value) => value != null ? `${Number(value).toFixed(2)} WAR` : "—"}
              />
              <SeasonTrendCard
                label="CF% 5v5 · By Season"
                data={seasonCharts}
                dataKey="avgCFPct"
                accent={seasonCharts.find((entry) => entry.isCurrent)?.avgCFPct >= 50 ? "#00e5a0" : "#f08040"}
                mutedColor="#415468"
                formatter={(value) => value != null ? `${Number(value).toFixed(1)}%` : "—"}
                showLeagueReference
              />
            </div>
          )}

          {/* ── Roster tabs ── */}
          <div style={{ marginBottom: 4 }}>
            <div style={{ display: "flex", gap: 0, background: "#0d1825",
              border: "1px solid #1e2d40", borderRadius: 10, overflow: "hidden",
              width: "fit-content", marginBottom: 0 }}>
              {[
                ["forwards", `Forwards (${forwards.length})`],
                ["defense",  `Defense (${defense.length})`],
                ["goalies",  `Goalies (${goalies.length})`],
              ].map(([t, label]) => (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding: "9px 22px",
                  background: tab === t ? color : "transparent",
                  border: "none",
                  color: tab === t ? "white" : "#4a6a88",
                  fontSize: 13, fontWeight: 700,
                  fontFamily: "'Barlow Condensed',sans-serif",
                  cursor: "pointer", transition: "all 0.2s",
                  letterSpacing: "0.03em",
                }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Roster table ── */}
          <div style={{ border: "1px solid #1e2d40", borderRadius: "0 10px 10px 10px",
            overflow: "hidden", background: "#060b12" }}>

            {/* Column header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12,
              padding: "7px 14px", background: "#0a1520",
              borderBottom: "1px solid #1e2d40" }}>
              <div style={{ width: 22 }} />
              <div style={{ width: 40, flexShrink: 0 }} />
              <div style={{ flex: "0 0 180px", fontSize: 9, color: "#2a4060",
                fontFamily: "'DM Mono',monospace", textTransform: "uppercase",
                letterSpacing: "0.08em" }}>Player</div>
              <div style={{ flex: 1, display: "flex", gap: 16, justifyContent: "flex-end",
                alignItems: "center" }}>
                {["GP","G","A","PTS","OVR","WAR",""].map(h => (
                  <div key={h} style={{ minWidth: h === "" ? 36 : h === "OVR" ? 38 : 30,
                    fontSize: 9, color: "#2a4060", fontFamily: "'DM Mono',monospace",
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    textAlign: "center" }}>
                    {h}
                  </div>
                ))}
              </div>
            </div>

            {activeRoster.length === 0 ? (
              <div style={{ padding: "32px 20px", textAlign: "center",
                color: "#2a4060", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>
                No {tab} on this roster.
              </div>
            ) : (
              activeRoster.map((p, i) => (
                <PlayerRow
                  key={p.player_id}
                  player={p}
                  rank={i + 1}
                  onSelect={setSelectedPlayer}
                />
              ))
            )}
          </div>

          {/* Footer */}
          <div style={{ marginTop: 24, fontSize: 10, color: "#1e3348",
            fontFamily: "'DM Mono',monospace", textAlign: "center" }}>
            Data: NHL API · Natural Stat Trick · Evolving-Hockey · TopDownHockey
          </div>
        </div>
      </div>

      {/* Player modal */}
      <PlayerModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />

      <style jsx>{`
        @media (max-width: 640px) {
          .team-season-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}
