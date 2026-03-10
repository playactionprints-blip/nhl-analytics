"use client";

import { useState, useMemo } from "react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from "recharts";

// ── Team metadata ────────────────────────────────────────────────────────────
const TEAM_COLOR = {
  ANA:"#F47A38",ARI:"#8C2633",BOS:"#FFB81C",BUF:"#003087",CAR:"#CC0000",
  CBJ:"#002654",CGY:"#C8102E",CHI:"#CF0A2C",COL:"#6F263D",DAL:"#006847",
  DET:"#CE1126",EDM:"#FF4C00",FLA:"#C8102E",LAK:"#111111",MIN:"#154734",
  MTL:"#AF1E2D",NSH:"#FFB81C",NJD:"#CC0000",NYI:"#00539B",NYR:"#0038A8",
  OTT:"#C52032",PHI:"#F74902",PIT:"#CFC493",SEA:"#99D9D9",SJS:"#006D75",
  STL:"#002F87",TBL:"#002868",TOR:"#00205B",UTA:"#69B3E7",VAN:"#00843D",
  VGK:"#B4975A",WPG:"#041E42",WSH:"#C8102E",
};

const TEAM_FULL = {
  ANA:"Anaheim Ducks",ARI:"Arizona Coyotes",BOS:"Boston Bruins",BUF:"Buffalo Sabres",
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
  const pts = player.pts ?? 0;
  const gp = player.gp ?? 0;
  const ptsPer82 = gp > 0 ? Math.round((pts / gp) * 82) : 0;
  const tabs = isGoalie ? ["goalie stats"] : ["overview", "on-ice", "war / rapm"];

  return (
    <div style={{ width:420, background:"linear-gradient(160deg,#0c1a28 0%,#081016 100%)", borderRadius:16, border:"1px solid #1e2d40", overflow:"hidden", boxShadow:`0 0 0 1px #0a1520,0 24px 60px rgba(0,0,0,0.6),0 0 80px ${accent}15`, fontFamily:"'Barlow Condensed',sans-serif", position:"relative" }}>
      {/* Top accent bar */}
      <div style={{ height:3, background:`linear-gradient(90deg,${accent},${accent}88,transparent)` }} />

      {/* Header */}
      <div style={{ padding:"20px 24px 16px", background:`linear-gradient(135deg,${accent}22 0%,transparent 60%)`, borderBottom:"1px solid #1a2535", position:"relative", overflow:"hidden" }}>
        {/* Jersey number watermark */}
        <div style={{ position:"absolute", right:-8, top:-10, fontSize:110, fontWeight:900, color:`${accent}18`, lineHeight:1, fontFamily:"'Barlow Condensed',sans-serif", userSelect:"none", letterSpacing:"-4px" }}>
          {player.jersey || ""}
        </div>

        <div style={{ display:"flex", gap:14, alignItems:"flex-start", position:"relative", zIndex:1 }}>
          {/* Headshot */}
          <PlayerAvatar player={player} size={72} />

          <div style={{ flex:1 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
              <span style={{ fontSize:11, color:accent, fontFamily:"'DM Mono',monospace", letterSpacing:"0.1em", textTransform:"uppercase" }}>
                {player.jersey ? `#${player.jersey}` : ""}{player.position ? ` · ${player.position}` : ""}
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
        <div style={{ position:"absolute", top:20, right:24, background:"#00e5a015", border:"1px solid #00e5a044", borderRadius:8, padding:"6px 12px", textAlign:"center", zIndex:2 }}>
          {isGoalie ? (
            <>
              <div style={{ fontSize:14, fontWeight:900, color:"#00e5a0", lineHeight:1 }}>G</div>
              <div style={{ fontSize:9, color:"#00e5a088", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em" }}>Goalie</div>
            </>
          ) : (
            <>
              <div style={{ fontSize:20, fontWeight:900, color:"#00e5a0", lineHeight:1 }}>{player.war ?? "—"}</div>
              <div style={{ fontSize:9, color:"#00e5a088", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em" }}>WAR</div>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", borderBottom:"1px solid #1a2535" }}>
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
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:16 }}>
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
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, padding:"10px 14px", background:"#0d1825", borderRadius:8, border:"1px solid #1e2d40" }}>
              <span style={{ fontSize:11, color:"#5a7a99", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em" }}>Avg TOI</span>
              <span style={{ fontSize:20, fontWeight:800, color:accent }}>{player.toi || "—"}</span>
            </div>
            <div style={{ marginBottom:4 }}>
              <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Percentile Profile vs. Forwards</div>
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
          </div>
        )}

        {!isGoalie && tab === "war / rapm" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:20 }}>
              <StatBox label="Total WAR" value={player.war} highlight />
              <StatBox label="Off WAR" value={player.war_off} />
              <StatBox label="Def WAR" value={player.war_def} />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:20 }}>
              <StatBox label="RAPM Off" value={player.rapm_off != null ? `+${player.rapm_off}` : null} />
              <StatBox label="RAPM Def" value={player.rapm_def != null ? `+${player.rapm_def}` : null} />
            </div>
            <div style={{ background:"#0d1825", border:"1px solid #1e2d40", borderRadius:8, padding:"12px 14px", marginBottom:16 }}>
              <div style={{ fontSize:10, color:"#3a5a78", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>What is WAR?</div>
              <p style={{ fontSize:11, color:"#5a7a99", lineHeight:1.6, margin:0, fontFamily:"'DM Mono',monospace" }}>Wins Above Replacement estimates how many wins a player contributes vs. a replacement-level player. Source: Evolving-Hockey.</p>
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {["Evolving-Hockey","Natural Stat Trick","NHL API"].map(src => (
                <span key={src} style={{ fontSize:9, padding:"3px 8px", background:"#0d1825", border:"1px solid #1e2d40", borderRadius:20, color:"#3a5a78", fontFamily:"'DM Mono',monospace" }}>{src}</span>
              ))}
            </div>
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
        <button key={abbr} onClick={() => onSelectTeam(abbr)} style={{ padding:"6px 10px", background:selectedTeam===abbr?`${TEAM_COLOR[abbr]}22`:"#0d1825", border:`1px solid ${selectedTeam===abbr?TEAM_COLOR[abbr]:"#1e2d40"}`, borderRadius:8, cursor:"pointer", transition:"all 0.2s", display:"flex", alignItems:"center", gap:6, boxShadow:selectedTeam===abbr?`0 2px 12px ${TEAM_COLOR[abbr]}44`:"none" }}>
          <TeamLogo abbr={abbr} size={24} />
          <span style={{ fontSize:11, fontWeight:700, color:selectedTeam===abbr?TEAM_COLOR[abbr]:"#4a6a88", fontFamily:"'Barlow Condensed',sans-serif" }}>{abbr}</span>
        </button>
      ))}
    </div>
  );
}

// ── App Shell ────────────────────────────────────────────────────────────────
export default function App({ players: propPlayers }) {
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

  const displayPlayer = selectedPlayer || filtered[0] || null;

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
      `}</style>

      <div style={{ minHeight:"100vh", background:"radial-gradient(ellipse at 20% 20%,#0d1e30 0%,#05090f 60%)", display:"flex", flexDirection:"column", alignItems:"center", padding:"40px 20px", fontFamily:"'Barlow Condensed',sans-serif" }}>

        {/* Header */}
        <div style={{ marginBottom:28, textAlign:"center" }}>
          <div style={{ fontSize:11, color:"#2a5070", letterSpacing:"0.2em", textTransform:"uppercase", fontFamily:"'DM Mono',monospace", marginBottom:8 }}>NHL Analytics</div>
          <h1 style={{ fontSize:42, fontWeight:900, color:"#e8f4ff", letterSpacing:"-1px", lineHeight:1 }}>Player Cards</h1>
          <div style={{ fontSize:12, color:"#2a4060", fontFamily:"'DM Mono',monospace", marginTop:6 }}>WAR · RAPM · On-Ice Shot Rates · Percentile Rankings</div>
        </div>

        {/* Mode toggle */}
        <div style={{ display:"flex", gap:0, marginBottom:20, background:"#0d1825", border:"1px solid #1e2d40", borderRadius:10, overflow:"hidden" }}>
          {[["search","🔍 Search Players"],["teams","🏒 Browse by Team"]].map(([mode,label]) => (
            <button key={mode} onClick={() => setBrowseMode(mode)} style={{ padding:"10px 24px", background:browseMode===mode?"#0080FF":"transparent", border:"none", color:browseMode===mode?"white":"#4a6a88", fontSize:13, fontWeight:700, fontFamily:"'Barlow Condensed',sans-serif", cursor:"pointer", transition:"all 0.2s", letterSpacing:"0.03em" }}>
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

        {/* Player list */}
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

        {/* Card */}
        {displayPlayer && (
          <div style={{ animation:"fadeUp 0.4s ease" }}>
            <PlayerCard key={displayPlayer.player_id} player={displayPlayer} />
          </div>
        )}

        {filtered.length === 0 && (
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
