"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip,
         LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";

// ── Team metadata ────────────────────────────────────────────────────────────
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
  LAK:"Los Angeles Kings",MIN:"Minnesota Wild",MTL:"Montreal Canadiens",
  NSH:"Nashville Predators",NJD:"New Jersey Devils",NYI:"New York Islanders",
  NYR:"New York Rangers",OTT:"Ottawa Senators",PHI:"Philadelphia Flyers",
  PIT:"Pittsburgh Penguins",SEA:"Seattle Kraken",SJS:"San Jose Sharks",
  STL:"St. Louis Blues",TBL:"Tampa Bay Lightning",TOR:"Toronto Maple Leafs",
  UTA:"Utah Hockey Club",VAN:"Vancouver Canucks",VGK:"Vegas Golden Knights",
  WPG:"Winnipeg Jets",WSH:"Washington Capitals",
};

const ALL_TEAMS = Object.keys(TEAM_FULL).sort();

// NHL API URL helpers
function headshotUrl(playerId) {
  return `https://assets.nhle.com/mugs/nhl/20242025/placeholder/${playerId}.png`;
}
function logoUrl(teamAbbr) {
  return `https://assets.nhle.com/logos/nhl/svg/${teamAbbr}_light.svg`;
}

// ── Utility ──────────────────────────────────────────────────────────────────
function pctColor(v) {
  if (v >= 85) return "#00e5a0";
  if (v >= 60) return "#f0c040";
  if (v >= 40) return "#f08040";
  return "#e05050";
}
function statColor(pct) {
  if (pct >= 52) return "#00e5a0";
  if (pct >= 48) return "#f0c040";
  return "#e05050";
}
function fmtMinSec(decimalMinutes) {
  if (decimalMinutes == null || isNaN(decimalMinutes)) return "—";
  const m = Math.floor(decimalMinutes);
  const s = Math.round((decimalMinutes - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Sub-components ───────────────────────────────────────────────────────────
function PercentileBar({ label, value }) {
  const color = pctColor(value);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
        <span style={{ fontSize:11, color:"#8899aa", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</span>
        <span style={{ fontSize:12, fontWeight:700, color, fontFamily:"'DM Mono',monospace" }}>{value}</span>
      </div>
      <div style={{ height:5, background:"#1a2535", borderRadius:3, overflow:"hidden" }}>
        <div style={{ width:`${value}%`, height:"100%", background:`linear-gradient(90deg,${color}88,${color})`, borderRadius:3, transition:"width 0.8s cubic-bezier(0.22,1,0.36,1)" }} />
      </div>
    </div>
  );
}

function StatBox({ label, value, highlight }) {
  return (
    <div style={{ background:highlight?"rgba(0,229,160,0.07)":"#0d1825", border:`1px solid ${highlight?"#00e5a088":"#1e2d40"}`, borderRadius:6, padding:"10px 12px", textAlign:"center" }}>
      <div style={{ fontSize:22, fontWeight:800, color:highlight?"#00e5a0":"#e8f0f8", fontFamily:"'Barlow Condensed',sans-serif", lineHeight:1 }}>{value ?? "—"}</div>
      <div style={{ fontSize:10, color:"#5a7a99", marginTop:3, fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</div>
    </div>
  );
}

function RapmBox({ label, value, pct, subtitle }) {
  const color = value != null ? (value >= 0 ? "#00e5a0" : "#e05050") : "#4a6a88";
  const sign  = value != null && value >= 0 ? "+" : "";
  return (
    <div style={{ background:"#0d1825", border:`1px solid ${color}44`, borderRadius:6, padding:"10px 12px" }}>
      <div style={{ fontSize:10, color:"#5a7a99", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:800, color, fontFamily:"'Barlow Condensed',sans-serif", lineHeight:1 }}>
        {value != null ? `${sign}${value.toFixed(4)}` : "—"}
      </div>
      <div style={{ fontSize:9, color:"#5a7a99", fontFamily:"'DM Mono',monospace", marginTop:3 }}>{subtitle}</div>
      {pct != null && (
        <>
          <div style={{ fontSize:10, color, fontFamily:"'DM Mono',monospace", marginTop:4 }}>
            {Math.round(pct)}th percentile among skaters
          </div>
          <div style={{ height:4, background:"#1a2535", borderRadius:2, marginTop:5, position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:1, background:"#2a3d55", zIndex:1 }} />
            <div style={{
              position:"absolute",
              left:  pct >= 50 ? "50%" : `${pct}%`,
              width: pct >= 50 ? `${pct - 50}%` : `${50 - pct}%`,
              height:"100%", background:color, opacity:0.8, borderRadius:2,
            }} />
          </div>
        </>
      )}
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
        <PolarGrid stroke="#1e2d40" />
        <PolarAngleAxis dataKey="metric" tick={{ fontSize:10, fill:"#5a7a99", fontFamily:"DM Mono,monospace" }} />
        <Radar dataKey="value" stroke={color} fill={color} fillOpacity={0.18} strokeWidth={2} dot={{ r:3, fill:color }} />
        <Tooltip contentStyle={{ background:"#0a1520", border:`1px solid ${color}44`, borderRadius:6, fontSize:12, fontFamily:"DM Mono,monospace" }} labelStyle={{ color:"#8899aa" }} itemStyle={{ color }} formatter={(v) => [`${v}th pct`,""]} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ── Player Avatar (headshot with fallback initials) ──────────────────────────
function PlayerAvatar({ player, size = 72 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const accent = TEAM_COLOR[player.team] || player.teamColor || "#4a6a88";
  const initials = `${(player.first_name||player.firstName||"?")[0]}${(player.last_name||player.lastName||"?")[0]}`;

  if (!imgFailed && player.headshot_url) {
    return (
      <div style={{ width:size, height:size, borderRadius:10, overflow:"hidden", border:`2px solid ${accent}66`, flexShrink:0, boxShadow:`0 4px 20px ${accent}44`, background:`linear-gradient(135deg,${accent}44,${accent}22)` }}>
        <img
          src={player.headshot_url}
          alt={player.full_name || player.name}
          width={size} height={size}
          style={{ objectFit:"cover", width:"100%", height:"100%" }}
          onError={() => setImgFailed(true)}
        />
      </div>
    );
  }
  return (
    <div style={{ width:size, height:size, borderRadius:10, background:`linear-gradient(135deg,${accent},${accent}88)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.3, fontWeight:900, color:"white", flexShrink:0, boxShadow:`0 4px 20px ${accent}44`, border:`2px solid ${accent}66`, letterSpacing:"-1px" }}>
      {initials}
    </div>
  );
}

// ── Team Logo ────────────────────────────────────────────────────────────────
function TeamLogo({ abbr, size = 32 }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span style={{ fontSize:11, fontWeight:700, color:"#4a6a88" }}>{abbr}</span>;
  return (
    <img src={logoUrl(abbr)} alt={abbr} width={size} height={size}
      style={{ objectFit:"contain" }}
      onError={() => setFailed(true)} />
  );
}

// ── Goalie Card Content ──────────────────────────────────────────────────────
function GoalieContent({ player, accent }) {
  const svPct = player.save_pct ? (player.save_pct * 100).toFixed(1) : null;
  const gaa = player.gaa ? player.gaa.toFixed(2) : null;
  return (
    <div>
      <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:14 }}>Goalie Stats — 2024–25</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:12 }}>
        <StatBox label="GP" value={player.gp} />
        <StatBox label="Wins" value={player.wins} highlight />
        <StatBox label="Losses" value={player.losses} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:20 }}>
        <StatBox label="GAA" value={gaa} />
        <StatBox label="SV%" value={svPct ? `${svPct}%` : null} highlight />
        <StatBox label="SO" value={player.shutouts} />
      </div>
      {/* SV% bar */}
      {svPct && (
        <div style={{ marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
            <span style={{ fontSize:11, color:"#8899aa", fontFamily:"'DM Mono',monospace" }}>Save Percentage</span>
            <span style={{ fontSize:13, fontWeight:700, color:accent, fontFamily:"'DM Mono',monospace" }}>{svPct}%</span>
          </div>
          <div style={{ height:8, background:"#1a2535", borderRadius:4, overflow:"hidden" }}>
            <div style={{ width:`${Math.min(parseFloat(svPct),100)}%`, height:"100%", background:accent, opacity:0.8, borderRadius:4 }} />
          </div>
        </div>
      )}
      <div style={{ background:"#0d1825", border:"1px solid #1e2d40", borderRadius:8, padding:"12px 14px" }}>
        <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>About Goalie Metrics</div>
        <p style={{ fontSize:11, color:"#5a7a99", lineHeight:1.6, margin:0, fontFamily:"'DM Mono',monospace" }}>
          GAA = Goals Against Average · SV% = Save Percentage · SO = Shutouts. Advanced goalie WAR coming soon via Evolving-Hockey.
        </p>
      </div>
    </div>
  );
}

// ── Main Player Card ─────────────────────────────────────────────────────────
function PlayerCard({ player }) {
  const [tab, setTab] = useState("overview");
  const teamAbbr = player.team || "";
  const accent = TEAM_COLOR[teamAbbr] || player.teamColor || "#4a6a88";
  const teamFull = TEAM_FULL[teamAbbr] || player.teamFull || teamAbbr;
  const firstName = player.first_name || player.firstName || "";
  const lastName = player.last_name || player.lastName || "";
  const isGoalie = (player.position || "").toUpperCase() === "G";
  const age = (() => {
    const bd = player.birth_date;
    if (!bd) return player.age ?? null;
    const today = new Date();
    const birth = new Date(bd);
    let a = today.getFullYear() - birth.getFullYear();
    if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) a--;
    return a;
  })();
  const pts = player.pts ?? 0;
  const gp = player.gp ?? 0;
  const ptsPer82 = gp > 0 ? Math.round((pts / gp) * 82) : 0;
  const tabs = isGoalie ? ["goalie stats"] : ["overview", "on-ice", "war / rapm", "ratings"];

  return (
    <div className="pc-card" style={{ width:420, background:"linear-gradient(160deg,#0c1a28 0%,#081016 100%)", borderRadius:16, border:"1px solid #1e2d40", overflow:"hidden", boxShadow:`0 0 0 1px #0a1520,0 24px 60px rgba(0,0,0,0.6),0 0 80px ${accent}15`, fontFamily:"'Barlow Condensed',sans-serif", position:"relative" }}>
      {/* Top accent bar */}
      <div style={{ height:3, background:`linear-gradient(90deg,${accent},${accent}88,transparent)` }} />

      {/* Header */}
      <div style={{ padding:"20px 24px 16px", background:`linear-gradient(135deg,${accent}22 0%,transparent 60%)`, borderBottom:"1px solid #1a2535", position:"relative", overflow:"hidden" }}>
        {/* Jersey number watermark */}
        <div className="pc-jersey" style={{ position:"absolute", right:-8, top:-10, fontSize:110, fontWeight:900, color:`${accent}18`, lineHeight:1, fontFamily:"'Barlow Condensed',sans-serif", userSelect:"none", letterSpacing:"-4px" }}>
          {player.jersey || ""}
        </div>

        <div className="pc-header-row" style={{ display:"flex", gap:14, alignItems:"flex-start", position:"relative", zIndex:1 }}>
          {/* Headshot */}
          <PlayerAvatar player={player} size={72} />

          <div style={{ flex:1 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
              <span style={{ fontSize:11, color:accent, fontFamily:"'DM Mono',monospace", letterSpacing:"0.1em", textTransform:"uppercase" }}>
                {player.jersey ? `#${player.jersey}` : ""}{player.position ? ` · ${player.position}` : ""}{age ? ` · ${age} yrs` : ""}
              </span>
            </div>
            <div style={{ fontSize:26, fontWeight:800, color:"#e8f4ff", lineHeight:1, letterSpacing:"-0.5px" }}>{firstName}</div>
            <div style={{ fontSize:30, fontWeight:900, color:"white", lineHeight:1, letterSpacing:"-1px", textTransform:"uppercase" }}>{lastName}</div>
            {/* Team row with logo */}
            <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:6 }}>
              <TeamLogo abbr={teamAbbr} size={20} />
              <span style={{ fontSize:11, color:"#4a6a88", fontFamily:"'DM Mono',monospace" }}>{teamFull}</span>
            </div>
          </div>
        </div>

        {/* WAR / position badge top right */}
        <div className="pc-war-badge" style={{ position:"absolute", top:20, right:24, background:"#00e5a015", border:"1px solid #00e5a044", borderRadius:8, padding:"6px 12px", textAlign:"center", zIndex:2 }}>
          {isGoalie ? (
            <>
              <div style={{ fontSize:14, fontWeight:900, color:"#00e5a0", lineHeight:1 }}>G</div>
              <div style={{ fontSize:9, color:"#00e5a088", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em" }}>Goalie</div>
            </>
          ) : (
            <>
              <div style={{ fontSize:20, fontWeight:900, color:"#00e5a0", lineHeight:1 }}>{player.war_total != null ? player.war_total.toFixed(1) : "—"}</div>
              <div style={{ fontSize:9, color:"#00e5a088", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em" }}>WAR</div>
            </>
          )}
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
        {isGoalie && <GoalieContent player={player} accent={accent} />}

        {!isGoalie && tab === "overview" && (
          <div>
            <div className="pc-stat-grid-4" style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:16 }}>
              <StatBox label="GP" value={player.gp} />
              <StatBox label="G" value={player.g} />
              <StatBox label="A" value={player.a} />
              <StatBox label="PTS" value={player.pts} highlight />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:20 }}>
              <StatBox label="PPP" value={player.ppp} />
              <StatBox label="+/-" value={player.plus_minus != null ? `${player.plus_minus > 0 ? "+" : ""}${player.plus_minus}` : null} />
              <StatBox label="Pts/82" value={ptsPer82 || null} highlight />
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, padding:"10px 14px", background:"#0d1825", borderRadius:8, border:"1px solid #1e2d40" }}>
              <span style={{ fontSize:11, color:"#5a7a99", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em" }}>Avg TOI</span>
              <span style={{ fontSize:20, fontWeight:800, color:accent }}>{player.toi || "—"}</span>
            </div>
            {((player.toi_pp > 0) || (player.toi_pk > 0)) && (player.gp > 0) && (
              <div style={{ display:"grid", gridTemplateColumns:(player.toi_pp > 0 && player.toi_pk > 0) ? "1fr 1fr" : "1fr", gap:8, marginBottom:player.contract_info?.cap_hit ? 8 : 16 }}>
                {player.toi_pp > 0 && (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 12px", background:"#0d1825", borderRadius:8, border:"1px solid #1e2d40" }}>
                    <span style={{ fontSize:10, color:"#5a7a99", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em" }}>PP TOI</span>
                    <span style={{ fontSize:14, fontWeight:800, color:"#38bdf8", fontFamily:"'Barlow Condensed',sans-serif" }}>{fmtMinSec(player.toi_pp / player.gp)}/gm</span>
                  </div>
                )}
                {player.toi_pk > 0 && (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 12px", background:"#0d1825", borderRadius:8, border:"1px solid #1e2d40" }}>
                    <span style={{ fontSize:10, color:"#5a7a99", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em" }}>PK TOI</span>
                    <span style={{ fontSize:14, fontWeight:800, color:"#818cf8", fontFamily:"'Barlow Condensed',sans-serif" }}>{fmtMinSec(player.toi_pk / player.gp)}/gm</span>
                  </div>
                )}
              </div>
            )}
            {player.contract_info?.cap_hit && (
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, padding:"10px 14px", background:"#0d1825", borderRadius:8, border:"1px solid #1e2d40" }}>
                <span style={{ fontSize:11, color:"#5a7a99", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em" }}>Cap Hit</span>
                <div style={{ textAlign:"right" }}>
                  <span style={{ fontSize:20, fontWeight:800, color:accent }}>${(player.contract_info.cap_hit / 1_000_000).toFixed(2)}M</span>
                  {player.contract_info.expiry && (
                    <span style={{ display:"block", fontSize:10, color:"#4a6a88", fontFamily:"'DM Mono',monospace" }}>
                      {player.contract_info.expiry}{player.contract_info.years_remaining != null ? ` · ${player.contract_info.years_remaining}yr rem.` : ""}
                    </span>
                  )}
                </div>
              </div>
            )}
            <div style={{ marginBottom:4 }}>
              <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>{player.position === "D" ? "Percentile Profile vs. Defensemen" : player.position === "G" ? "Percentile Profile vs. Goalies" : "Percentile Profile vs. Forwards"}</div>
              <RadarViz percentiles={player.percentiles} color={accent} />
            </div>
          </div>
        )}

        {!isGoalie && tab === "on-ice" && (
          <div>
            <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:14 }}>5v5 On-Ice Rates</div>
            {[
              { label:"CF% (Corsi For)", value:player.cf_pct },
              { label:"xGF% (Exp. Goals For)", value:player.xgf_pct },
              { label:"HDCF% (High Danger)", value:player.hdcf_pct },
              { label:"SCF% (Scoring Chances)", value:player.scf_pct },
            ].filter(s => s.value != null).map(stat => (
              <div key={stat.label} style={{ marginBottom:14 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <span style={{ fontSize:11, color:"#8899aa", fontFamily:"'DM Mono',monospace" }}>{stat.label}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:statColor(stat.value), fontFamily:"'DM Mono',monospace" }}>{stat.value}%</span>
                </div>
                <div style={{ height:8, background:"#1a2535", borderRadius:4, position:"relative", overflow:"hidden" }}>
                  <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:1, background:"#2a3d55", zIndex:1 }} />
                  <div style={{ position:"absolute", left:stat.value>=50?"50%":`${stat.value}%`, width:stat.value>=50?`${stat.value-50}%`:`${50-stat.value}%`, height:"100%", background:statColor(stat.value), opacity:0.8, borderRadius:4, transition:"width 0.8s cubic-bezier(0.22,1,0.36,1)" }} />
                </div>
              </div>
            ))}
            {Object.keys(player.percentiles||{}).length > 0 && (
              <div style={{ marginTop:20 }}>
                <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:12 }}>Percentile Rankings</div>
                {Object.entries(player.percentiles).map(([k,v]) => <PercentileBar key={k} label={k} value={v} />)}
              </div>
            )}

            {/* Special Teams */}
            <div style={{ marginTop:20 }}>
              <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>Special Teams</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>

                {/* Power Play card */}
                {(() => {
                  const tpp    = player.toi_pp;
                  const cfpp   = player.cf_pct_pp;
                  const xgfpp  = player.xgf_pp;
                  const gp     = player.gp || 1;
                  const per60  = tpp > 0 && xgfpp != null ? xgfpp / tpp * 60 : null;
                  const C      = "#38bdf8";
                  return (
                    <div style={{ background:"#0a1520", border:`1px solid ${C}22`, borderRadius:8, padding:"10px 12px" }}>
                      <div style={{ fontSize:10, color:C, fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>⚡ Power Play</div>
                      {tpp == null || tpp < 20 ? (
                        <div style={{ fontSize:11, color:tpp == null ? "#2a4060" : "#3a5a78", fontFamily:"'DM Mono',monospace", padding:"4px 0" }}>
                          {tpp == null ? "Not deployed" : "Limited PP time"}
                        </div>
                      ) : (
                        <>
                          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
                            <span style={{ fontSize:10, color:"#5a7a99", fontFamily:"'DM Mono',monospace" }}>TOI</span>
                            <span style={{ fontSize:13, fontWeight:700, color:C, fontFamily:"'DM Mono',monospace" }}>{fmtMinSec(tpp / gp)}/gm</span>
                          </div>
                          {cfpp != null && (
                            <div style={{ marginBottom:8 }}>
                              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                                <span style={{ fontSize:10, color:"#8899aa", fontFamily:"'DM Mono',monospace" }}>CF% on PP</span>
                                <span style={{ fontSize:11, fontWeight:700, color:statColor(cfpp), fontFamily:"'DM Mono',monospace" }}>{cfpp.toFixed(1)}%</span>
                              </div>
                              <div style={{ height:5, background:"#1a2535", borderRadius:3, position:"relative", overflow:"hidden" }}>
                                <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:1, background:"#2a3d55", zIndex:1 }} />
                                <div style={{ position:"absolute", left:cfpp>=50?"50%":`${cfpp}%`, width:cfpp>=50?`${cfpp-50}%`:`${50-cfpp}%`, height:"100%", background:C, opacity:0.75, borderRadius:3 }} />
                              </div>
                            </div>
                          )}
                          {per60 != null && (
                            <div>
                              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                                <span style={{ fontSize:10, color:"#8899aa", fontFamily:"'DM Mono',monospace" }}>xGF/60 on PP</span>
                                <span style={{ fontSize:11, fontWeight:700, color:per60 >= 2.8 ? C : "#e05050", fontFamily:"'DM Mono',monospace" }}>{per60.toFixed(2)}</span>
                              </div>
                              {(() => {
                                const norm = Math.min(100, Math.max(0, per60 / 5.6 * 100));
                                return (
                                  <div style={{ height:5, background:"#1a2535", borderRadius:3, position:"relative", overflow:"hidden" }}>
                                    <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:1, background:"#2a3d55", zIndex:1 }} />
                                    <div style={{ position:"absolute", left:norm>=50?"50%":`${norm}%`, width:norm>=50?`${norm-50}%`:`${50-norm}%`, height:"100%", background:norm>=50?C:"#e05050", opacity:0.75, borderRadius:3 }} />
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* Penalty Kill card */}
                {(() => {
                  const tpk    = player.toi_pk;
                  const cfpk   = player.cf_pct_pk;
                  const xgapk  = player.xga_pk;
                  const gp     = player.gp || 1;
                  const per60  = tpk > 0 && xgapk != null ? xgapk / tpk * 60 : null;
                  const C      = "#818cf8";
                  return (
                    <div style={{ background:"#0a1520", border:`1px solid ${C}22`, borderRadius:8, padding:"10px 12px" }}>
                      <div style={{ fontSize:10, color:C, fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>🛡 Penalty Kill</div>
                      {tpk == null || tpk < 20 ? (
                        <div style={{ fontSize:11, color:tpk == null ? "#2a4060" : "#3a5a78", fontFamily:"'DM Mono',monospace", padding:"4px 0" }}>
                          {tpk == null ? "Not deployed" : "Limited PK time"}
                        </div>
                      ) : (
                        <>
                          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
                            <span style={{ fontSize:10, color:"#5a7a99", fontFamily:"'DM Mono',monospace" }}>TOI</span>
                            <span style={{ fontSize:13, fontWeight:700, color:C, fontFamily:"'DM Mono',monospace" }}>{fmtMinSec(tpk / gp)}/gm</span>
                          </div>
                          {cfpk != null && (
                            <div style={{ marginBottom:8 }}>
                              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                                <span style={{ fontSize:10, color:"#8899aa", fontFamily:"'DM Mono',monospace" }}>CF% on PK</span>
                                <span style={{ fontSize:11, fontWeight:700, color:statColor(cfpk), fontFamily:"'DM Mono',monospace" }}>{cfpk.toFixed(1)}%</span>
                              </div>
                              <div style={{ height:5, background:"#1a2535", borderRadius:3, position:"relative", overflow:"hidden" }}>
                                <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:1, background:"#2a3d55", zIndex:1 }} />
                                <div style={{ position:"absolute", left:cfpk>=50?"50%":`${cfpk}%`, width:cfpk>=50?`${cfpk-50}%`:`${50-cfpk}%`, height:"100%", background:C, opacity:0.75, borderRadius:3 }} />
                              </div>
                            </div>
                          )}
                          {per60 != null && (
                            <div>
                              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                                <span style={{ fontSize:10, color:"#8899aa", fontFamily:"'DM Mono',monospace" }}>xGA/60 on PK</span>
                                <span style={{ fontSize:11, fontWeight:700, color:per60 < 2.4 ? C : "#e05050", fontFamily:"'DM Mono',monospace" }}>{per60.toFixed(2)}</span>
                              </div>
                              {(() => {
                                const invNorm = Math.min(100, Math.max(0, (1 - per60 / 4.8) * 100));
                                return (
                                  <div style={{ height:5, background:"#1a2535", borderRadius:3, position:"relative", overflow:"hidden" }}>
                                    <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:1, background:"#2a3d55", zIndex:1 }} />
                                    <div style={{ position:"absolute", left:invNorm>=50?"50%":`${invNorm}%`, width:invNorm>=50?`${invNorm-50}%`:`${50-invNorm}%`, height:"100%", background:invNorm>=50?C:"#e05050", opacity:0.75, borderRadius:3 }} />
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}

              </div>
            </div>
          </div>
        )}

        {!isGoalie && tab === "war / rapm" && (
          <div>
            {/* WAR boxes — colored by total WAR magnitude */}
            {(() => {
              const wt = player.war_total;
              const wtColor = wt == null ? "#4a6a88" : wt > 2.0 ? "#00e5a0" : wt >= 0.5 ? "#f0c040" : "#e05050";
              return (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:16 }}>
                  <div style={{ background:wt != null ? `${wtColor}12` : "#0d1825", border:`1px solid ${wt != null ? `${wtColor}55` : "#1e2d40"}`, borderRadius:6, padding:"10px 12px", textAlign:"center" }}>
                    <div style={{ fontSize:22, fontWeight:800, color:wtColor, fontFamily:"'Barlow Condensed',sans-serif", lineHeight:1 }}>
                      {wt != null ? wt.toFixed(2) : "—"}
                    </div>
                    <div style={{ fontSize:10, color:"#5a7a99", marginTop:3, fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em" }}>Total WAR</div>
                  </div>
                  <StatBox label="EV Off WAR" value={player.war_ev_off != null ? player.war_ev_off.toFixed(2) : null} />
                  <StatBox label="EV Def WAR" value={player.war_ev_def != null ? player.war_ev_def.toFixed(2) : null} />
                </div>
              );
            })()}
            {/* RAPM boxes with percentile + centered bar */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
              <RapmBox label="RAPM OFF" value={player.rapm_off} pct={player.rapm_off_pct} subtitle="xG/60 above avg" />
              <RapmBox label="RAPM DEF" value={player.rapm_def} pct={player.rapm_def_pct} subtitle="xG/60 above avg" />
            </div>
            <div style={{ background:"#0d1825", border:"1px solid #1e2d40", borderRadius:8, padding:"12px 14px", marginBottom:16 }}>
              <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>About These Metrics</div>
              <p style={{ fontSize:11, color:"#5a7a99", lineHeight:1.6, margin:0, fontFamily:"'DM Mono',monospace" }}>WAR (Wins Above Replacement) estimates how many wins a player contributes above a replacement-level player, combining 5v5, power play, and penalty kill contributions. RAPM (Regularized Adjusted Plus-Minus) measures individual impact in xG per 60 minutes at 5v5, controlling for teammates and opponents. Both metrics built from NHL play-by-play data.</p>
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {["Natural Stat Trick","NHL API","Custom RAPM Model"].map(src => (
                <span key={src} style={{ fontSize:9, padding:"3px 8px", background:"#0d1825", border:"1px solid #1e2d40", borderRadius:20, color:"#3a5a78", fontFamily:"'DM Mono',monospace" }}>{src}</span>
              ))}
            </div>
          </div>
        )}

        {!isGoalie && tab === "ratings" && (
          <div>
            {/* Overall rating — large centered number */}
            <div style={{ textAlign:"center", marginBottom:24 }}>
              <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Overall Rating</div>
              <div style={{ fontSize:72, fontWeight:900, lineHeight:1, color: pctColor(player.overall_rating ?? 0) }}>
                {player.overall_rating != null ? Math.round(player.overall_rating) : "—"}
              </div>
              <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", marginTop:4 }}>out of 100</div>
            </div>

            {/* Off / Def side by side */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:20 }}>
              <StatBox label="Offensive Rating" value={player.off_rating != null ? Math.round(player.off_rating) : null} highlight />
              <StatBox label="Defensive Rating" value={player.def_rating != null ? Math.round(player.def_rating) : null} />
            </div>

            {/* Three rating bars */}
            {[
              { label:"Overall",    value: player.overall_rating },
              { label:"Offensive",  value: player.off_rating },
              { label:"Defensive",  value: player.def_rating },
            ].filter(r => r.value != null).map(r => (
              <div key={r.label} style={{ marginBottom:14 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <span style={{ fontSize:11, color:"#8899aa", fontFamily:"'DM Mono',monospace" }}>{r.label}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:pctColor(r.value), fontFamily:"'DM Mono',monospace" }}>{r.value.toFixed(1)}</span>
                </div>
                <div style={{ height:8, background:"#1a2535", borderRadius:4, overflow:"hidden" }}>
                  <div style={{ width:`${r.value}%`, height:"100%", background:`linear-gradient(90deg,${pctColor(r.value)}88,${pctColor(r.value)})`, borderRadius:4, transition:"width 0.8s cubic-bezier(0.22,1,0.36,1)" }} />
                </div>
              </div>
            ))}

            {/* Season trend chart */}
            {(player.ratings_trend?.length > 1) && (
              <div style={{ background:"#0d1825", border:"1px solid #1e2d40", borderRadius:8, padding:"12px 14px", marginTop:8 }}>
                <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10 }}>3-Season Trend</div>
                <div style={{ display:"flex", gap:14, marginBottom:8 }}>
                  {[["Overall","#e8f4ff"],["Offensive","#00e5a0"],["Defensive","#f08040"]].map(([l,c]) => (
                    <div key={l} style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <div style={{ width:16, height:2, background:c, borderRadius:1 }} />
                      <span style={{ fontSize:9, color:"#5a7a99", fontFamily:"'DM Mono',monospace" }}>{l}</span>
                    </div>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={player.ratings_trend} margin={{ top:4, right:8, left:-24, bottom:0 }}>
                    <CartesianGrid stroke="#1e2d40" strokeDasharray="3 3" />
                    <XAxis dataKey="season" tick={{ fontSize:9, fill:"#5a7a99", fontFamily:"DM Mono,monospace" }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize:9, fill:"#5a7a99", fontFamily:"DM Mono,monospace" }} />
                    <Tooltip contentStyle={{ background:"#0a1520", border:"1px solid #1e2d40", borderRadius:6, fontSize:11, fontFamily:"DM Mono,monospace" }} labelStyle={{ color:"#8899aa" }} itemStyle={{ padding:1 }} />
                    <Line type="monotone" dataKey="overall"  stroke="#e8f4ff" strokeWidth={2} dot={{ r:3, fill:"#e8f4ff" }} name="Overall" />
                    <Line type="monotone" dataKey="off"      stroke="#00e5a0" strokeWidth={2} dot={{ r:3, fill:"#00e5a0" }} name="Offensive" />
                    <Line type="monotone" dataKey="def"      stroke="#f08040" strokeWidth={2} dot={{ r:3, fill:"#f08040" }} name="Defensive" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop:"1px solid #1a2535", padding:"10px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:9, color:"#2a4060", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em" }}>2024–25 Regular Season</span>
        <span style={{ fontSize:9, color:"#2a4060", fontFamily:"'DM Mono',monospace" }}>hockeystats.dev</span>
      </div>
    </div>
  );
}

// ── Team Browse Grid ─────────────────────────────────────────────────────────
function TeamGrid({ onSelectTeam, selectedTeam }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", maxWidth:700 }}>
      <button onClick={() => onSelectTeam(null)} style={{ padding:"6px 16px", background:!selectedTeam?"#0080FF":"#0d1825", border:`1px solid ${!selectedTeam?"#0080FF":"#1e2d40"}`, borderRadius:8, color:!selectedTeam?"white":"#4a6a88", fontSize:12, fontWeight:700, fontFamily:"'Barlow Condensed',sans-serif", cursor:"pointer", transition:"all 0.2s" }}>
        All Teams
      </button>
      {ALL_TEAMS.map(abbr => (
        <div key={abbr} style={{ display:"flex", alignItems:"center", gap:2 }}>
          <button onClick={() => onSelectTeam(abbr)} style={{ padding:"6px 10px", background:selectedTeam===abbr?`${TEAM_COLOR[abbr]}22`:"#0d1825", border:`1px solid ${selectedTeam===abbr?TEAM_COLOR[abbr]:"#1e2d40"}`, borderRadius:"8px 0 0 8px", cursor:"pointer", transition:"all 0.2s", display:"flex", alignItems:"center", gap:6, boxShadow:selectedTeam===abbr?`0 2px 12px ${TEAM_COLOR[abbr]}44`:"none" }}>
            <TeamLogo abbr={abbr} size={24} />
            <span style={{ fontSize:11, fontWeight:700, color:selectedTeam===abbr?TEAM_COLOR[abbr]:"#4a6a88", fontFamily:"'Barlow Condensed',sans-serif" }}>{abbr}</span>
          </button>
          <Link href={`/team/${abbr}`} title={`${TEAM_FULL[abbr]} team page`} style={{ padding:"6px 7px", background:"#0a1218", border:`1px solid #1e2d40`, borderLeft:"none", borderRadius:"0 8px 8px 0", display:"flex", alignItems:"center", textDecoration:"none" }}>
            <span style={{ fontSize:11, color:"#2a4060" }}>↗</span>
          </Link>
        </div>
      ))}
    </div>
  );
}

// ── Stats Table ───────────────────────────────────────────────────────────────
function StatsTable({ players, seasonStats, onSelectPlayer, selectedId }) {
  const [sortKey, setSortKey] = useState('pts');
  const [sortDir, setSortDir] = useState('desc');
  const [posFilter, setPosFilter] = useState('S');
  const [tableSearch, setTableSearch] = useState('');
  const [selectedSeason, setSelectedSeason] = useState('players'); // 'players' | '25-26' | '24-25' | '23-24'

  // Use season-specific data when a historical season is selected
  const activePlayers = selectedSeason === 'players'
    ? players
    : (seasonStats?.[selectedSeason] || []);

  const COLS = [
    { key:'full_name',      sortKey:'full_name',      label:'Player',  align:'left'   },
    { key:'team',           sortKey:'team',            label:'Team',    align:'left',   mobileHide:true },
    { key:'position',       sortKey:'position',        label:'Pos',     align:'center', mobileHide:true },
    { key:'gp',             sortKey:'gp',              label:'GP',      align:'right',  mobileHide:true },
    { key:'g',              sortKey:'g',               label:'G',       align:'right',  mobileHide:true },
    { key:'a',              sortKey:'a',               label:'A',       align:'right',  mobileHide:true },
    { key:'pts',            sortKey:'pts',             label:'PTS',     align:'right',  bold:true },
    { key:'plus_minus',     sortKey:'plus_minus',      label:'+/-',     align:'right',  mobileHide:true },
    { key:'ppp',            sortKey:'ppp',             label:'PPP',     align:'right',  mobileHide:true },
    { key:'toi',            sortKey:'toi_min',         label:'TOI',     align:'right',  mobileHide:true },
    { key:'cf_pct',         sortKey:'cf_pct',          label:'CF%',     align:'right',  pctStat:true, mobileHide:true },
    { key:'xgf_pct',        sortKey:'xgf_pct',         label:'xGF%',   align:'right',  pctStat:true, mobileHide:true },
    { key:'hdcf_pct',       sortKey:'hdcf_pct',        label:'HDCF%',  align:'right',  pctStat:true, mobileHide:true },
    { key:'scf_pct',        sortKey:'scf_pct',         label:'SCF%',   align:'right',  pctStat:true, mobileHide:true },
    { key:'ixg',            sortKey:'ixg',             label:'ixG',     align:'right',  mobileHide:true },
    { key:'icf',            sortKey:'icf',             label:'iCF',     align:'right',  mobileHide:true },
    { key:'tka',            sortKey:'tka',             label:'TKA',     align:'right',  mobileHide:true },
    { key:'gva',            sortKey:'gva',             label:'GVA',     align:'right',  mobileHide:true },
    { key:'blk',            sortKey:'blk',             label:'BLK',     align:'right',  mobileHide:true },
    { key:'hits',           sortKey:'hits',            label:'HITS',    align:'right',  mobileHide:true },
    { key:'off_rating',     sortKey:'off_rating',      label:'OFF',     align:'right',  bold:true, rating:true, mobileHide:true },
    { key:'def_rating',     sortKey:'def_rating',      label:'DEF',     align:'right',  bold:true, rating:true, mobileHide:true },
    { key:'overall_rating', sortKey:'overall_rating',  label:'OVR',     align:'right',  bold:true, rating:true },
    { key:'war_total',      sortKey:'war_total',       label:'WAR',     align:'right'  },
  ];

  function parseToi(toi) {
    if (!toi) return null;
    const parts = String(toi).split(':');
    return parseInt(parts[0]) + (parseInt(parts[1]) || 0) / 60;
  }

  const enriched = useMemo(() => activePlayers.map(p => ({ ...p, toi_min: parseToi(p.toi) })), [activePlayers]);

  const filtered = useMemo(() => {
    let list = enriched;
    if (posFilter === 'S') list = list.filter(p => p.position !== 'G');
    else if (posFilter === 'F') list = list.filter(p => ['C','L','R'].includes(p.position));
    else if (posFilter === 'D') list = list.filter(p => p.position === 'D');
    else if (posFilter === 'G') list = list.filter(p => p.position === 'G');
    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase();
      list = list.filter(p => (p.full_name||'').toLowerCase().includes(q) || (p.team||'').toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [enriched, posFilter, tableSearch, sortKey, sortDir]);

  function handleSort(sk) {
    if (sortKey === sk) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(sk); setSortDir('desc'); }
  }

  function fmtCell(p, col) {
    const v = p[col.key];
    if (v == null) return '—';
    if (col.key === 'plus_minus') return v > 0 ? `+${v}` : `${v}`;
    if (col.pctStat) return typeof v === 'number' ? v.toFixed(1) : v;
    if (col.rating) return typeof v === 'number' ? Math.round(v) : v;
    if (col.key === 'ixg' || col.key === 'war_total') return typeof v === 'number' ? v.toFixed(1) : v;
    return v;
  }

  function cellColor(p, col) {
    const v = p[col.key];
    if (v == null) return '#2a4060';
    if (col.pctStat) return statColor(v);
    if (col.rating) return pctColor(v);
    if (col.key === 'full_name') return '#c8dff0';
    if (col.key === 'team') return TEAM_COLOR[v] || '#4a6a88';
    return '#6a8aaa';
  }

  return (
    <div style={{ width:'100%' }}>
      <div style={{ display:'flex', gap:12, marginBottom:14, alignItems:'center', flexWrap:'wrap' }}>
        <input type="text" placeholder="Filter players or teams..." value={tableSearch}
          onChange={e => setTableSearch(e.target.value)}
          style={{ padding:'8px 16px', background:'#0d1825', border:'1px solid #1e2d40', borderRadius:8, color:'#e8f4ff', fontSize:14, fontFamily:"'Barlow Condensed',sans-serif", outline:'none', width:260 }} />
        <div style={{ display:'flex', gap:4 }}>
          {[['S','Skaters'],['F','Forwards'],['D','Defense'],['G','Goalies'],['All','All']].map(([v,l]) => (
            <button key={v} onClick={() => setPosFilter(v)}
              style={{ padding:'6px 14px', background:posFilter===v?'#0080FF':'#0d1825', border:`1px solid ${posFilter===v?'#0080FF':'#1e2d40'}`, borderRadius:6, color:posFilter===v?'white':'#4a6a88', fontSize:12, fontWeight:700, fontFamily:"'Barlow Condensed',sans-serif", cursor:'pointer', transition:'all 0.2s' }}>
              {l}
            </button>
          ))}
        </div>
        {/* Season selector */}
        <div style={{ display:'flex', gap:4 }}>
          {[['players','Current'],['25-26','25–26'],['24-25','24–25'],['23-24','23–24']].map(([v,l]) => (
            <button key={v} onClick={() => { setSelectedSeason(v); setSortKey(v==='players'?'pts':'pts'); }}
              style={{ padding:'6px 12px', background:selectedSeason===v?'#334466':'#0d1825', border:`1px solid ${selectedSeason===v?'#5577aa':'#1e2d40'}`, borderRadius:6, color:selectedSeason===v?'#c8dff0':'#4a6a88', fontSize:11, fontWeight:700, fontFamily:"'Barlow Condensed',sans-serif", cursor:'pointer', transition:'all 0.2s' }}>
              {l}
            </button>
          ))}
        </div>
        <span style={{ fontSize:11, color:'#2a4060', fontFamily:"'DM Mono',monospace" }}>{filtered.length} players</span>
      </div>

      <div style={{ overflowX:'auto', border:'1px solid #1e2d40', borderRadius:10 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontFamily:"'DM Mono',monospace", fontSize:12, minWidth:1400 }}>
          <thead>
            <tr style={{ background:'#0a1520' }}>
              <th style={{ padding:'9px 8px', color:'#2a4060', fontSize:10, fontWeight:400, width:36, borderBottom:'1px solid #1e2d40', textAlign:'center' }}>#</th>
              {COLS.map(col => (
                <th key={col.key} onClick={() => handleSort(col.sortKey)}
                  className={col.mobileHide ? "tbl-col-hide" : ""}
                  style={{ padding:'9px 10px', textAlign:col.align, borderBottom:'1px solid #1e2d40', color:sortKey===col.sortKey?'#c8dff0':'#3a5a78', fontSize:10, fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase', cursor:'pointer', whiteSpace:'nowrap', userSelect:'none', background:sortKey===col.sortKey?'#0d1825':'transparent' }}>
                  {col.label}{sortKey===col.sortKey ? (sortDir==='desc'?' ↓':' ↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => {
              const isSelected = selectedId === p.player_id;
              return (
                <tr key={p.player_id} onClick={() => onSelectPlayer(p)}
                  style={{ borderBottom:'1px solid #0a1218', cursor:'pointer', background: isSelected ? '#0d2a1a' : i%2===0 ? '#080e17' : '#060b12' }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#0d1825'; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isSelected ? '#0d2a1a' : i%2===0 ? '#080e17' : '#060b12'; }}>
                  <td style={{ padding:'6px 8px', textAlign:'center', color:'#2a4060', fontSize:10 }}>{i+1}</td>
                  {COLS.map(col => (
                    <td key={col.key} className={col.mobileHide ? "tbl-col-hide" : ""} style={{ padding:'6px 10px', textAlign:col.align, color:cellColor(p,col), fontWeight:col.bold && p[col.key] != null ? 700 : 400, whiteSpace:col.key==='full_name'?'nowrap':'normal', fontSize:col.key==='full_name'?13:12, fontFamily:col.key==='full_name'?"'Barlow Condensed',sans-serif":"'DM Mono',monospace" }}>
                      {fmtCell(p, col)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── App Shell ────────────────────────────────────────────────────────────────
export default function App({ players: propPlayers, seasonStats }) {
  const allPlayers = propPlayers?.length ? propPlayers : [];
  const [search, setSearch] = useState("");
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [browseMode, setBrowseMode] = useState("search"); // "search" | "teams"

  // Filter players
  const filtered = useMemo(() => {
    let list = allPlayers;
    if (selectedTeam) list = list.filter(p => (p.team||"").toUpperCase() === selectedTeam);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => (p.full_name||p.name||"").toLowerCase().includes(q));
    }
    return list.slice(0, 50);
  }, [allPlayers, selectedTeam, search]);

  const displayPlayer = selectedPlayer;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        body { background:#05090f; }
        input::placeholder { color:#2a4060; }
        button:hover { opacity:0.85; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:#0d1825; }
        ::-webkit-scrollbar-thumb { background:#1e2d40; border-radius:2px; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        .pc-modal-backdrop { display:none; }
        .pc-modal-close-btn { display:none; }
        @media (max-width:639px) {
          .app-outer { padding:16px 10px 40px !important; }
          .app-h1 { font-size:28px !important; letter-spacing:-0.5px !important; }
          .app-mode-btn { padding:8px 10px !important; font-size:11px !important; }
          .pc-card { width:calc(100vw - 24px) !important; }
          .pc-header-row { flex-direction:column !important; align-items:center !important; gap:8px !important; }
          .pc-jersey { font-size:70px !important; }
          .pc-war-badge { top:10px !important; right:10px !important; padding:4px 8px !important; }
          .pc-tabs-bar { overflow-x:auto !important; -webkit-overflow-scrolling:touch; }
          .pc-stat-grid-4 { grid-template-columns:repeat(2,1fr) !important; }
          .tbl-col-hide { display:none !important; }
          .pc-modal-backdrop { display:block !important; position:fixed !important; inset:0 !important; z-index:199 !important; background:rgba(0,9,15,0.85) !important; }
          .pc-modal-close-btn { display:flex !important; align-items:center !important; justify-content:center !important; position:fixed !important; top:16px !important; right:16px !important; z-index:201 !important; min-width:44px !important; min-height:44px !important; width:44px !important; height:44px !important; border-radius:22px !important; background:#1a2535 !important; border:1px solid #2a3d55 !important; color:#e8f4ff !important; font-size:20px !important; cursor:pointer !important; line-height:1 !important; }
          .pc-modal-wrapper { position:fixed !important; inset:0 !important; z-index:200 !important; display:flex !important; flex-direction:column !important; align-items:center !important; padding:70px 12px 24px !important; overflow-y:auto !important; background:transparent !important; }
        }
      `}</style>

      <div className="app-outer" style={{ minHeight:"100vh", background:"radial-gradient(ellipse at 20% 20%,#0d1e30 0%,#05090f 60%)", display:"flex", flexDirection:"column", alignItems:"center", padding:"40px 20px", fontFamily:"'Barlow Condensed',sans-serif" }}>

        {/* Header */}
        <div style={{ marginBottom:28, textAlign:"center" }}>
          <div style={{ fontSize:11, color:"#2a5070", letterSpacing:"0.2em", textTransform:"uppercase", fontFamily:"'DM Mono',monospace", marginBottom:8 }}>NHL Analytics</div>
          <h1 className="app-h1" style={{ fontSize:42, fontWeight:900, color:"#e8f4ff", letterSpacing:"-1px", lineHeight:1 }}>Player Cards</h1>
          <div style={{ fontSize:12, color:"#2a4060", fontFamily:"'DM Mono',monospace", marginTop:6 }}>WAR · RAPM · On-Ice Shot Rates · Percentile Rankings</div>
        </div>

        {/* Mode toggle */}
        <div style={{ display:"flex", gap:0, marginBottom:20, background:"#0d1825", border:"1px solid #1e2d40", borderRadius:10, overflow:"hidden" }}>
          {[["search","🔍 Search Players"],["teams","🏒 Browse by Team"],["table","📊 Stats Table"]].map(([mode,label]) => (
            <button key={mode} onClick={() => setBrowseMode(mode)} className="app-mode-btn" style={{ padding:"10px 24px", background:browseMode===mode?"#0080FF":"transparent", border:"none", color:browseMode===mode?"white":"#4a6a88", fontSize:13, fontWeight:700, fontFamily:"'Barlow Condensed',sans-serif", cursor:"pointer", transition:"all 0.2s", letterSpacing:"0.03em" }}>
              {label}
            </button>
          ))}
        </div>

        {/* Search mode */}
        {browseMode === "search" && (
          <div style={{ width:"100%", maxWidth:500, marginBottom:20 }}>
            <input
              type="text"
              placeholder="Search any player..."
              value={search}
              onChange={e => { setSearch(e.target.value); setSelectedPlayer(null); }}
              style={{ width:"100%", padding:"14px 20px", background:"#0d1825", border:"1px solid #1e2d40", borderRadius:12, color:"#e8f4ff", fontSize:16, fontFamily:"'Barlow Condensed',sans-serif", outline:"none", letterSpacing:"0.03em" }}
            />
          </div>
        )}

        {/* Team browse mode */}
        {browseMode === "teams" && (
          <div style={{ marginBottom:24 }}>
            <TeamGrid onSelectTeam={(t) => { setSelectedTeam(t); setSelectedPlayer(null); }} selectedTeam={selectedTeam} />
          </div>
        )}

        {/* Stats table mode */}
        {browseMode === "table" && (
          <div style={{ width:"100%", maxWidth:1400, marginBottom:24 }}>
            <StatsTable
              players={allPlayers}
              seasonStats={seasonStats}
              onSelectPlayer={p => setSelectedPlayer(prev => prev?.player_id === p.player_id ? null : p)}
              selectedId={selectedPlayer?.player_id}
            />
          </div>
        )}

        {/* Player list (search/teams modes only) */}
        {browseMode !== "table" && (
        <div style={{ display:"flex", gap:8, marginBottom:28, flexWrap:"wrap", justifyContent:"center", maxWidth:800 }}>
          {filtered.map(p => {
            const color = TEAM_COLOR[p.team] || "#4a6a88";
            const isSelected = displayPlayer?.player_id === p.player_id;
            return (
              <button key={p.player_id} onClick={() => setSelectedPlayer(p)} style={{ padding:"6px 14px", background:isSelected?color:"#0d1825", border:`1px solid ${isSelected?color:"#1e2d40"}`, borderRadius:8, color:isSelected?"white":"#4a6a88", fontSize:12, fontWeight:700, fontFamily:"'Barlow Condensed',sans-serif", cursor:"pointer", letterSpacing:"0.03em", transition:"all 0.2s", boxShadow:isSelected?`0 4px 20px ${color}44`:"none", display:"flex", alignItems:"center", gap:6 }}>
                {p.full_name || p.name}
              </button>
            );
          })}
        </div>
        )}

        {/* Card */}
        {displayPlayer && (
          <>
            <div className="pc-modal-backdrop" onClick={() => setSelectedPlayer(null)} />
            <button className="pc-modal-close-btn" onClick={() => setSelectedPlayer(null)} aria-label="Close">✕</button>
            <div className="pc-modal-wrapper" onClick={e => { if (e.target === e.currentTarget) setSelectedPlayer(null); }}>
              <div style={{ animation:"fadeUp 0.4s ease" }}>
                <PlayerCard key={displayPlayer.player_id} player={displayPlayer} />
              </div>
            </div>
          </>
        )}

        {browseMode !== "table" && filtered.length === 0 && (
          <div style={{ color:"#2a4060", fontFamily:"'DM Mono',monospace", fontSize:13, marginTop:40 }}>
            No players found. Try a different search.
          </div>
        )}

        <div style={{ marginTop:28, fontSize:10, color:"#1e3348", fontFamily:"'DM Mono',monospace", textAlign:"center", maxWidth:400 }}>
          Data: NHL API · Natural Stat Trick · Evolving-Hockey · TopDownHockey
        </div>
      </div>
    </>
  );
}

export { PlayerCard };
