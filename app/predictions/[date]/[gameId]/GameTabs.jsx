const TABS = [
  ["Overview", "overview"],
  ["Game Flow", "game-flow"],
  ["Team Stats", "team-stats"],
  ["Players", "players"],
  ["Scoring", "scoring"],
  ["Highlights", "highlights"],
  ["Model", "model"],
];

export default function GameTabs() {
  return (
    <>
      <nav className="game-tabs-shell">
        <div className="game-tabs-row">
          {TABS.map(([label, id]) => (
            <a key={id} href={`#${id}`} className="game-tab-link">
              {label}
            </a>
          ))}
        </div>
      </nav>
      <style>{`
        .game-tabs-shell {
          position: sticky;
          top: 72px;
          z-index: 30;
          backdrop-filter: blur(10px);
          background: rgba(6, 10, 16, 0.78);
          border: 1px solid #16293d;
          border-radius: 18px;
          padding: 10px 12px;
        }
        .game-tabs-row {
          display: flex;
          gap: 10px;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .game-tabs-row::-webkit-scrollbar {
          display: none;
        }
        .game-tab-link {
          flex: 0 0 auto;
          border-radius: 999px;
          border: 1px solid #1a3046;
          background: #0d1722;
          color: #8fb1cd;
          padding: 8px 12px;
          text-decoration: none;
          font-size: 11px;
          font-weight: 700;
          font-family: 'DM Mono', monospace;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
        }
        .game-tab-link:hover {
          border-color: #2d5678;
          color: #dff3ff;
          background: #111d29;
        }
      `}</style>
    </>
  );
}

