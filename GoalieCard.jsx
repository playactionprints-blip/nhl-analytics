"use client";

import { useState } from "react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip,
         AreaChart, Area, CartesianGrid, Line, XAxis, YAxis } from "recharts";

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

function pctColor(v) {
  if (v >= 85) return "#00e5a0";
  if (v >= 60) return "#f0c040";
  if (v >= 40) return "#f08040";
  return "#e05050";
}

function logoUrl(abbr) {
  return `https://assets.nhle.com/logos/nhl/svg/${abbr}_light.svg`;
}

function PlayerAvatar({ player, size = 72 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const accent = TEAM_COLOR[player.team] || player.teamColor || "#4a6a88";
  const initials = `${(player.first_name||player.firstName||"?")[0]}${(player.last_name||player.lastName||"?")[0]}`;
  if (!imgFailed && player.headshot_url) {
    return (
      <div style={{ width:size, height:size, borderRadius:10, overflow:"hidden", border:`2px solid ${accent}66`, flexShrink:0, boxShadow:`0 4px 20px ${accent}44`, background:`linear-gradient(135deg,${accent}44,${accent}22)` }}>
        <img src={player.headshot_url} alt={player.full_name || player.name}
          width={size} height={size} style={{ objectFit:"cover", width:"100%", height:"100%" }}
          onError={() => setImgFailed(true)} />
      </div>
    );
  }
  return (
    <div style={{ width:size, height:size, borderRadius:10, background:`linear-gradient(135deg,${accent},${accent}88)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.3, fontWeight:900, color:"white", flexShrink:0, boxShadow:`0 4px 20px ${accent}44`, border:`2px solid ${accent}66`, letterSpacing:"-1px" }}>
      {initials}
    </div>
  );
}

function TeamLogo({ abbr, size = 32 }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span style={{ fontSize:11, fontWeight:700, color:"#4a6a88" }}>{abbr}</span>;
  return (
    <img src={logoUrl(abbr)} alt={abbr} width={size} height={size}
      style={{ objectFit:"contain" }} onError={() => setFailed(true)} />
  );
}

function StatBox({ label, value, highlight }) {
  return (
    <div style={{ background:highlight?"rgba(0,229,160,0.07)":"var(--bg-secondary)", border:`1px solid ${highlight?"#00e5a088":"var(--border-strong)"}`, borderRadius:6, padding:"10px 12px", textAlign:"center" }}>
      <div style={{ fontSize:22, fontWeight:800, color:highlight?"#00e5a0":"#e8f0f8", fontFamily:"'Barlow Condensed',sans-serif", lineHeight:1 }}>{value ?? "—"}</div>
      <div style={{ fontSize:10, color:"#5a7a99", marginTop:3, fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</div>
    </div>
  );
}

function RatingBar({ label, pct, note }) {
  const color = pctColor(pct);
  return (
    <div style={{ marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:4 }}>
        <div>
          <span style={{ fontSize:11, color:"#8899aa", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</span>
          {note && <span style={{ fontSize:9, color:"#3a5a78", fontFamily:"'DM Mono',monospace", marginLeft:6 }}>{note}</span>}
        </div>
        <span style={{ fontSize:12, fontWeight:700, color, fontFamily:"'DM Mono',monospace" }}>{pct != null ? Math.round(pct) : "—"}</span>
      </div>
      <div style={{ height:5, background:"#1a2535", borderRadius:3, overflow:"hidden" }}>
        <div style={{ width:`${pct ?? 0}%`, height:"100%", background:`linear-gradient(90deg,${color}88,${color})`, borderRadius:3, transition:"width 0.8s cubic-bezier(0.22,1,0.36,1)" }} />
      </div>
    </div>
  );
}

function RadarViz({ percentiles, color }) {
  const entries = Object.entries(percentiles || {});
  if (!entries.length) return (
    <div style={{ height:120, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <span style={{ fontSize:11, color:"#2a4060", fontFamily:"'DM Mono',monospace" }}>No percentile data yet</span>
    </div>
  );
  const data = entries.map(([k,v]) => ({ metric:k, value:v, fullMark:100 }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="72%">
        <PolarGrid stroke="var(--border-strong)" />
        <PolarAngleAxis dataKey="metric" tick={{ fontSize:10, fill:"#5a7a99", fontFamily:"DM Mono,monospace" }} />
        <Radar dataKey="value" stroke={color} fill={color} fillOpacity={0.18} strokeWidth={2} dot={{ r:3, fill:color }} />
        <Tooltip contentStyle={{ background:"var(--bg-card)", border:`1px solid ${color}44`, borderRadius:6, fontSize:12, fontFamily:"DM Mono,monospace" }} labelStyle={{ color:"#8899aa" }} itemStyle={{ color }} formatter={(v) => [`${v}th pct`,""]} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function GoalieTrendPanel({ data, lines, accent }) {
  const valid = (data || []).filter((row) => lines.some((line) => row[line.key] != null));
  if (valid.length < 2) return null;
  return (
    <div style={{ background: "#0f141b", border: "1px solid #1b232d", borderRadius: 18, padding: "18px 18px 14px" }}>
      <div style={{ fontSize: 11, color: "#717780", fontFamily: "'DM Mono',monospace", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
        Performance Trend
      </div>
      <div style={{ fontSize: 15, color: "#f1efe9", fontWeight: 700, marginBottom: 10 }}>GSAx Percentile · By Season</div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={valid} margin={{ top: 8, right: 10, left: -22, bottom: 2 }}>
          <CartesianGrid stroke="#1f2833" strokeDasharray="0" vertical={true} />
          <XAxis dataKey="season" tick={{ fontSize: 11, fill: "#7f8388", fontFamily: "DM Mono,monospace" }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#7f8388", fontFamily: "DM Mono,monospace" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#0a1016", border: "1px solid #283240", borderRadius: 10, fontSize: 12, fontFamily: "DM Mono,monospace" }}
            labelStyle={{ color: "#9da4ad" }}
            formatter={(v, _name, item) => [v != null ? Number(v).toFixed(1) : "—", item?.payload?.label || item?.name || "Value"]}
          />
          {lines.map((line) => (
            <Area key={`${line.key}-area`} type="monotone" dataKey={line.key} stroke="none"
              fill={line.color || accent} fillOpacity={0.15} connectNulls />
          ))}
          {lines.map((line) => (
            <Line key={line.key} type="monotone" dataKey={line.key} stroke={line.color || accent}
              strokeWidth={3} dot={{ r: 5, fill: line.color || accent, strokeWidth: 0 }}
              activeDot={{ r: 6, fill: line.color || accent }} name={line.label} connectNulls />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function GoalieRankedBar({ label, value, color }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "148px 1fr 42px", gap: 10, alignItems: "center" }}>
      <div style={{ fontSize: 17, color: "#8d9197", fontWeight: 600 }}>{label}</div>
      <div style={{ height: 8, background: "#1a2028", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${clamp(value || 0, 0, 100)}%`, height: "100%", background: color, borderRadius: 999 }} />
      </div>
      <div style={{ fontSize: 16, color: "#f1efe9", fontWeight: 800, textAlign: "right" }}>
        {value != null ? Math.round(value) : "—"}
      </div>
    </div>
  );
}

function GoalieMetricTile({ label, value, subtitle, color }) {
  return (
    <div style={{ background: "#151b22", border: "1px solid #232c36", borderRadius: 16, padding: "16px 18px 14px", minHeight: 108 }}>
      <div style={{ fontSize: 14, color: "#7e838a", fontWeight: 600, marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 26, color: color || "#f1efe9", fontWeight: 900, lineHeight: 1, marginBottom: 8 }}>
        {value ?? "—"}
      </div>
      <div style={{ fontSize: 13, color: "#7d838b", fontFamily: "'DM Mono',monospace" }}>{subtitle}</div>
    </div>
  );
}

export function GoalieCard({ player }) {
  const [tab, setTab] = useState("overview");
  const teamAbbr  = player.team || "";
  const accent    = TEAM_COLOR[teamAbbr] || player.teamColor || "#4a6a88";
  const teamFull  = TEAM_FULL[teamAbbr] || teamAbbr;
  const firstName = player.first_name || player.firstName || "";
  const lastName  = player.last_name  || player.lastName  || "";

  const age = (() => {
    const bd = player.birth_date;
    if (!bd) return player.age ?? null;
    const today = new Date();
    const birth = new Date(bd);
    let a = today.getFullYear() - birth.getFullYear();
    if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) a--;
    return a;
  })();

  // SV% in hockey notation: .921
  const svPct = player.save_pct != null
    ? `.${String(Math.round(player.save_pct * 1000)).padStart(3, "0")}`
    : null;
  const gaa      = player.gaa      != null ? player.gaa.toFixed(2) : null;
  const wlRecord = (player.wins != null && player.losses != null)
    ? `${player.wins}-${player.losses}` : null;
  const gsax = player.gsax != null ? player.gsax.toFixed(1) : null;
  const xga = player.expected_goals_against != null ? player.expected_goals_against.toFixed(1) : null;
  const expectedSvPct = player.expected_save_pct != null
    ? `.${String(Math.round(player.expected_save_pct * 1000)).padStart(3, "0")}`
    : null;
  const svAboveExpected = player.save_pct_above_expected != null
    ? `${player.save_pct_above_expected >= 0 ? "+" : ""}${(player.save_pct_above_expected * 100).toFixed(1)}%`
    : null;
  const gsaxPct = player.gsax_pct ?? player.percentiles?.GSAx ?? null;
  const svAboveExpectedPct = player.sv_ae_pct ?? null;

  const tabs = ["overview", "stats", "ratings", "percentile card"];
  const cardWidth = tab === "percentile card" ? 700 : 420;

  return (
    <div className="pc-card" style={{ width:cardWidth, maxWidth:"95vw", background:"linear-gradient(160deg,var(--bg-card) 0%,var(--bg-card) 100%)", borderRadius:16, border:"1px solid var(--border-strong)", overflow:"hidden", boxShadow:`0 0 0 1px var(--bg-card),0 24px 60px rgba(0,0,0,0.6),0 0 80px ${accent}15`, fontFamily:"'Barlow Condensed',sans-serif", position:"relative", transition:"width 0.2s ease" }}>

      {/* Top accent bar */}
      <div style={{ height:3, background:`linear-gradient(90deg,${accent},${accent}88,transparent)` }} />

      {/* Header */}
      <div style={{ padding:"20px 24px 16px", background:`linear-gradient(135deg,${accent}22 0%,transparent 60%)`, borderBottom:"1px solid #1a2535", position:"relative", overflow:"hidden" }}>
        <div className="pc-jersey" style={{ position:"absolute", right:-8, top:-10, fontSize:110, fontWeight:900, color:`${accent}18`, lineHeight:1, fontFamily:"'Barlow Condensed',sans-serif", userSelect:"none", letterSpacing:"-4px" }}>
          {player.jersey || ""}
        </div>

        <div className="pc-header-row" style={{ display:"flex", gap:14, alignItems:"flex-start", position:"relative", zIndex:1 }}>
          <PlayerAvatar player={player} size={72} />
          <div style={{ flex:1 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
              <span style={{ fontSize:11, color:accent, fontFamily:"'DM Mono',monospace", letterSpacing:"0.1em", textTransform:"uppercase" }}>
                {player.jersey ? `#${player.jersey}` : ""}{" · G"}{age ? ` · ${age} yrs` : ""}
              </span>
            </div>
            <div style={{ fontSize:26, fontWeight:800, color:"#e8f4ff", lineHeight:1, letterSpacing:"-0.5px" }}>{firstName}</div>
            <div style={{ fontSize:30, fontWeight:900, color:"white", lineHeight:1, letterSpacing:"-1px", textTransform:"uppercase" }}>{lastName}</div>
            <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:6 }}>
              <TeamLogo abbr={teamAbbr} size={20} />
              <span style={{ fontSize:11, color:"#4a6a88", fontFamily:"'DM Mono',monospace" }}>{teamFull}</span>
            </div>
          </div>
        </div>

        {/* OVR badge top right */}
        <div className="pc-war-badge" style={{ position:"absolute", top:20, right:24, background:"#00e5a015", border:"1px solid #00e5a044", borderRadius:8, padding:"6px 12px", textAlign:"center", zIndex:2 }}>
          <div style={{ fontSize:20, fontWeight:900, color:"#00e5a0", lineHeight:1 }}>
            {player.overall_rating != null ? Math.round(player.overall_rating) : "—"}
          </div>
          <div style={{ fontSize:9, color:"#00e5a088", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em" }}>OVR</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="pc-tabs-bar" style={{ display:"flex", borderBottom:"1px solid #1a2535" }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ flex:1, padding:"10px 0", background:"none", border:"none", borderBottom:tab===t?`2px solid ${accent}`:"2px solid transparent", color:tab===t?"#e8f4ff":"#3a5a78", fontSize:10, fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em", cursor:"pointer", transition:"all 0.2s", fontWeight:tab===t?700:400, marginBottom:-1 }}>
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding:"18px 20px 20px" }}>

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <div>
            {/* 2×2 stat grid */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginBottom:12 }}>
              <StatBox label="W-L" value={wlRecord} highlight />
              <StatBox label="GAA" value={gaa} />
              <StatBox label="SV%" value={svPct} highlight />
              <StatBox label="SO"  value={player.shutouts} />
            </div>

            {/* GP + avg TOI row */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 12px", background:"var(--bg-secondary)", borderRadius:8, border:"1px solid var(--border-strong)" }}>
                <span style={{ fontSize:10, color:"#5a7a99", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em" }}>GP</span>
                <span style={{ fontSize:18, fontWeight:800, color:accent, fontFamily:"'Barlow Condensed',sans-serif" }}>{player.gp ?? "—"}</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 12px", background:"var(--bg-secondary)", borderRadius:8, border:"1px solid var(--border-strong)" }}>
                <span style={{ fontSize:10, color:"#5a7a99", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em" }}>Avg TOI</span>
                <span style={{ fontSize:18, fontWeight:800, color:accent, fontFamily:"'Barlow Condensed',sans-serif" }}>{player.toi || "—"}</span>
              </div>
            </div>

            {/* Radar */}
            <div>
              <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Percentile Profile vs. Goalies</div>
              <RadarViz percentiles={player.percentiles} color={accent} />
            </div>
          </div>
        )}

        {/* ── STATS ── */}
        {tab === "stats" && (
          <div>
            <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>Season Stats</div>

            {/* Table header */}
            <div style={{ display:"grid", gridTemplateColumns:"3fr 2fr 1.5fr 1.5fr 1.5fr 1.5fr 2fr 1.5fr", padding:"6px 10px", background:"var(--bg-card)", borderRadius:"6px 6px 0 0", border:"1px solid var(--border-strong)", borderBottom:"none" }}>
              {["Season","Team","GP","W","L","GAA","SV%","SO"].map((h,i) => (
                <div key={h} style={{ fontSize:9, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.07em", textAlign:i <= 1 ? "left" : "right" }}>{h}</div>
              ))}
            </div>

            {/* Current season row */}
            <div style={{ display:"grid", gridTemplateColumns:"3fr 2fr 1.5fr 1.5fr 1.5fr 1.5fr 2fr 1.5fr", padding:"8px 10px", background:"var(--bg-primary)", border:"1px solid var(--border-strong)", borderRadius:"0 0 6px 6px" }}>
              {[
                "25–26",
                player.team || "—",
                player.gp ?? "—",
                player.wins ?? "—",
                player.losses ?? "—",
                gaa ?? "—",
                svPct ?? "—",
                player.shutouts ?? "—",
              ].map((v, i) => (
                <div key={i} style={{ fontSize:12, color: i===6 ? "#00e5a0" : i===5 ? "#f08040" : "#6a8aaa", fontFamily:"'DM Mono',monospace", fontWeight: i===5||i===6 ? 700 : 400, textAlign: i <= 1 ? "left" : "right" }}>
                  {v}
                </div>
              ))}
            </div>

            <div style={{ marginTop:10, fontSize:10, color:"#2a4060", fontFamily:"'DM Mono',monospace", textAlign:"center" }}>
              Historical season data coming soon
            </div>

            {/* GSAx Advanced Stats */}
            <div style={{ marginTop:16 }}>
              <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>Expected Goals Model</div>
              {(gsax != null || xga != null) ? (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
                  <StatBox label="GSAx" value={gsax} highlight={player.gsax > 0} />
                  <StatBox label="xGA" value={xga} />
                  <StatBox label="Exp SV%" value={expectedSvPct} />
                  <StatBox label="SV% Above Exp" value={svAboveExpected} highlight={player.save_pct_above_expected > 0} />
                </div>
              ) : (
                <div style={{ padding:"10px 12px", background:"var(--bg-card)", border:"1px solid var(--border-strong)", borderRadius:6, textAlign:"center" }}>
                  <span style={{ fontSize:10, color:"#2a4060", fontFamily:"'DM Mono',monospace" }}>GSAx: Insufficient data</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── RATINGS ── */}
        {tab === "ratings" && (
          <div>
            {/* Big overall rating */}
            <div style={{ textAlign:"center", marginBottom:20, padding:"14px 14px 10px", background:"var(--bg-secondary)", borderRadius:10, border:`1px solid ${accent}44` }}>
              <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Overall Goalie Rating</div>
              <div style={{ fontSize:56, fontWeight:900, color: player.overall_rating != null ? pctColor(player.overall_rating) : "#2a4060", lineHeight:1, fontFamily:"'Barlow Condensed',sans-serif" }}>
                {player.overall_rating != null ? Math.round(player.overall_rating) : "—"}
              </div>
              <div style={{ fontSize:10, color:"#2a4060", fontFamily:"'DM Mono',monospace", marginTop:6 }}>vs. all qualified goalies (≥10 GP)</div>
            </div>

            <RatingBar label="Save %" pct={player.sv_pct_pct} />
            <RatingBar label="Goals Against" pct={player.gaa_pct} note="lower GAA = higher rating" />
            <RatingBar label="Win %" pct={player.win_pct_pct} />
            <RatingBar label="Shutout Rate" pct={player.shutout_pct} />
            {gsaxPct != null && <RatingBar label="GSAx" pct={gsaxPct} />}
            {svAboveExpectedPct != null && <RatingBar label="SV% Above Expected" pct={svAboveExpectedPct} />}

            <div style={{ marginTop:14, display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
              <StatBox label="GSAx" value={gsax} highlight={player.gsax > 0} />
              <StatBox label="xGA" value={xga} />
              <StatBox label="Exp SV%" value={expectedSvPct} />
              <StatBox label="SV% Above Exp" value={svAboveExpected} highlight={player.save_pct_above_expected > 0} />
            </div>
          </div>
        )}

        {/* ── PERCENTILE CARD ── */}
        {tab === "percentile card" && (() => {
          const gsaxTrend = player.gsaxTrend || [];
          const svAboveExpFmt = player.save_pct_above_expected != null
            ? `${player.save_pct_above_expected >= 0 ? "+" : ""}${(player.save_pct_above_expected).toFixed(3).slice(1)}`
            : "—";
          const gsaxPerXgaFmt = player.gsax_per_xga != null
            ? `${player.gsax_per_xga >= 0 ? "+" : ""}${player.gsax_per_xga.toFixed(3)}`
            : "—";
          const wlRecord = (player.wins != null && player.losses != null)
            ? `${player.wins}-${player.losses}` : null;

          return (
            <div>
              {/* Section 1 — Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  {/* Team badge circle */}
                  <div style={{ width: 66, height: 66, borderRadius: "50%", background: `${accent}22`, border: `2px solid ${accent}55`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <img src={`https://assets.nhle.com/logos/nhl/svg/${player.team || ""}_light.svg`}
                      alt={player.team} width={48} height={48} style={{ objectFit: "contain" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 900, color: "#e8f4ff", lineHeight: 1.1, letterSpacing: "-0.5px" }}>
                      {firstName} {lastName}
                    </div>
                    <div style={{ fontSize: 11, color: "#4a6a88", fontFamily: "'DM Mono',monospace", marginTop: 4 }}>
                      G{age ? ` · ${age} yrs` : ""}{player.toi ? ` · ${player.toi} avg TOI` : ""}
                    </div>
                  </div>
                </div>

                {/* GSAx %ile badge */}
                <div style={{ background: "#00e5a015", border: "1px solid #00e5a044", borderRadius: 10, padding: "10px 16px", textAlign: "center", flexShrink: 0 }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: "#00e5a0", lineHeight: 1 }}>
                    {gsaxPct != null ? Math.round(gsaxPct) : "—"}
                  </div>
                  <div style={{ fontSize: 9, color: "#00e5a088", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 3 }}>
                    GSAx %ile
                  </div>
                </div>
              </div>

              {/* Section 2 — Trend + Raw stats sidebar */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 0.98fr", gap: 14, marginBottom: 20 }}>
                {/* Trend */}
                <div>
                  {gsaxTrend.length >= 2 ? (
                    <GoalieTrendPanel
                      data={gsaxTrend}
                      lines={[{ key: "gsax", label: "GSAx", color: "#00e5a0" }]}
                      accent={accent}
                    />
                  ) : (
                    <div style={{ background: "#0f141b", border: "1px solid #1b232d", borderRadius: 18, padding: "18px 18px 14px", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 11, color: "#2a4060", fontFamily: "'DM Mono',monospace", textAlign: "center" }}>
                        Trend data available after multiple seasons
                      </span>
                    </div>
                  )}
                </div>

                {/* Raw stat sidebar */}
                <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-strong)", borderRadius: 16, padding: "14px 16px" }}>
                  <div style={{ fontSize: 10, color: "#3a5a78", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
                    Raw Stats
                  </div>
                  {[
                    { label: "SV%",     val: svPct },
                    { label: "GAA",     val: gaa },
                    { label: "GSAx",    val: gsax, signed: true },
                    { label: "W-L",     val: wlRecord },
                    { label: "Exp SV%", val: expectedSvPct },
                    { label: "xGA",     val: xga },
                  ].map(({ label, val, signed }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #111d2a" }}>
                      <span style={{ fontSize: 11, color: "#4a6a88", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: signed && val != null ? (player.gsax > 0 ? "#00e5a0" : "#e05050") : "#c8dff0", fontFamily: "'DM Mono',monospace" }}>
                        {val ?? "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 3 — Percentile bars */}
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-strong)", borderRadius: 14, padding: "16px 18px", marginBottom: 20 }}>
                <div style={{ fontSize: 10, color: "#3a5a78", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>
                  Percentile Rankings
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <GoalieRankedBar label="Save %" value={player.sv_pct_pct} color="#00e5a0" />
                  <GoalieRankedBar label="Goals Against" value={player.gaa_pct} color="#19c2ff" />
                  <GoalieRankedBar label="GSAx" value={gsaxPct} color="#32e39a" />
                  <GoalieRankedBar label="Win %" value={player.win_pct_pct} color="#f0c040" />
                </div>
              </div>

              {/* Section 4 — Metric tiles */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                <GoalieMetricTile
                  label="GSAx"
                  value={gsax}
                  subtitle={`${gsaxPct != null ? Math.round(gsaxPct) : "—"}th %ile`}
                  color="#00e5a0"
                />
                <GoalieMetricTile
                  label="SV% Above Exp"
                  value={svAboveExpFmt}
                  subtitle="vs expected"
                  color={player.save_pct_above_expected != null && player.save_pct_above_expected > 0 ? "#00e5a0" : "#e05050"}
                />
                <GoalieMetricTile
                  label="Exp SV%"
                  value={expectedSvPct}
                  subtitle="model baseline"
                  color="#8899aa"
                />
                <GoalieMetricTile
                  label="GSAx/xGA"
                  value={gsaxPerXgaFmt}
                  subtitle="efficiency"
                  color="#8899aa"
                />
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  );
}
