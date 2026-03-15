"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { LOTTERY_ASSUMPTIONS, NHL_LOTTERY_RULES } from "@/app/lib/lotteryConfig";
import { simulateLottery, simulateManyLotteries } from "@/app/lib/lotteryEngine";
import { logoUrl } from "@/app/lib/nhlTeams";
import { resolve2026FirstRoundOrder } from "@/app/lib/lotteryResolver";

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function movementMeta(movement) {
  if (movement > 0) return { label: `Up ${movement}`, color: "#35e3a0", symbol: "▲" };
  if (movement < 0) return { label: `Down ${Math.abs(movement)}`, color: "#ff6f7b", symbol: "▼" };
  return { label: "No change", color: "#7f93a8", symbol: "•" };
}

function ownershipMeta(row) {
  if (row.isStaticSlot) {
    return { label: "Static slot", color: "#8ed0ff", bg: "rgba(74, 167, 255, 0.16)" };
  }
  if (row.requiresManualReview) {
    return { label: "Manual review", color: "#ffb86d", bg: "rgba(255, 171, 64, 0.16)" };
  }
  if (row.protectionTriggered) {
    return { label: "Protected / retained", color: "#ff7c8d", bg: "rgba(255, 111, 123, 0.16)" };
  }
  if (row.isTradedPick) {
    return { label: "Conveyed", color: "#35e3a0", bg: "rgba(53, 227, 160, 0.16)" };
  }
  return { label: "Original owner", color: "#7f93a8", bg: "rgba(127, 147, 168, 0.16)" };
}

function LegendPill({ label, color, bg }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 10px",
        borderRadius: 999,
        background: bg,
        color,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontFamily: "'DM Mono',monospace",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
        }}
      />
      {label}
    </div>
  );
}

function TeamLogo({ abbr, size = 34 }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl(abbr)}
      alt={abbr}
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
    />
  );
}

function ConditionTooltip({ note }) {
  if (!note) return null;
  return (
    <span
      className="lottery-tooltip"
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        borderRadius: "50%",
        border: "1px solid #29455f",
        color: "#8ed0ff",
        background: "#101a25",
        fontSize: 11,
        fontWeight: 800,
        cursor: "help",
        flexShrink: 0,
      }}
      aria-label={note}
    >
      i
      <span
        className="lottery-tooltip-panel"
        style={{
          position: "absolute",
          left: "50%",
          bottom: "calc(100% + 10px)",
          transform: "translateX(-50%)",
          minWidth: 240,
          maxWidth: 320,
          padding: "10px 12px",
          borderRadius: 12,
          background: "rgba(9, 16, 23, 0.98)",
          border: "1px solid #25435a",
          color: "#d9ecfa",
          fontSize: 12,
          lineHeight: 1.4,
          boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
          opacity: 0,
          pointerEvents: "none",
          transition: "opacity 0.16s ease, transform 0.16s ease",
          zIndex: 20,
        }}
      >
        {note}
      </span>
    </span>
  );
}

function PickOwnershipCluster({ originalTeam, selectionOwner, isProtected, note }) {
  const ownerChanged = selectionOwner && selectionOwner !== originalTeam;
  const isRetainedProtected = isProtected && !ownerChanged;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            opacity: ownerChanged ? 0.38 : 1,
            filter: ownerChanged ? "grayscale(0.7)" : "none",
            transition: "opacity 0.16s ease, filter 0.16s ease",
          }}
        >
          <TeamLogo abbr={originalTeam} size={34} />
        </div>
        {ownerChanged && (
          <>
            <span
              style={{
                color: isProtected ? "#ff9ca8" : "#5ed5ff",
                fontSize: 14,
                fontWeight: 900,
                fontFamily: "'DM Mono',monospace",
              }}
            >
              →
            </span>
            <TeamLogo abbr={selectionOwner} size={34} />
          </>
        )}
      </div>
      <ConditionTooltip note={note} />
      {(ownerChanged || isRetainedProtected) && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 8px",
            borderRadius: 999,
            background: isRetainedProtected ? "rgba(255, 111, 123, 0.14)" : "rgba(53, 227, 160, 0.14)",
            color: isRetainedProtected ? "#ff8d9b" : "#47e8aa",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontFamily: "'DM Mono',monospace",
          }}
        >
          {isRetainedProtected ? "Protected" : "Conveyed"}
        </span>
      )}
    </div>
  );
}

function ResultBadge({ row }) {
  const meta = movementMeta(row.movement);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 9px",
        borderRadius: 999,
        background: `${meta.color}18`,
        color: meta.color,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontFamily: "'DM Mono',monospace",
      }}
    >
      <span>{meta.symbol}</span>
      {meta.label}
    </span>
  );
}

function HistoryRow({ item, index }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        border: "1px solid #1b2734",
        borderRadius: 14,
        background: "#0d141d",
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "#6f8aa6", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Sim #{index + 1}
        </div>
        <div style={{ fontSize: 10, color: "#4d637b", fontFamily: "'DM Mono',monospace" }}>
          seed {item.seed}
        </div>
      </div>
      <div style={{ fontSize: 13, color: "#d8ebfb" }}>
        {item.winners.length > 0
          ? item.winners.map((winner) => `${winner.currentOwner} won pick ${winner.wonPick}`).join(" · ")
          : "No completed drawings"}
      </div>
    </div>
  );
}

export default function LotterySimulator({ initialEntries, nonLotteryOrder, pickLedger, generatedAt }) {
  const [entries] = useState(initialEntries);
  const [result, setResult] = useState(null);
  const [revealCount, setRevealCount] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [history, setHistory] = useState([]);
  const [seedInput, setSeedInput] = useState("");
  const [summary, setSummary] = useState(null);
  const timersRef = useRef([]);

  const baseOrder = useMemo(() => [...entries].sort((a, b) => a.baseRank - b.baseRank), [entries]);
  const hasEntries = baseOrder.length > 0;

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current = [];
    };
  }, []);

  function clearTimers() {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current = [];
  }

  function runSimulation() {
    if (!hasEntries) return;
    clearTimers();
    setSummary(null);
    const seed = seedInput.trim() ? Number(seedInput.trim()) : Date.now();
    const nextResult = simulateLottery(entries, { seed, config: NHL_LOTTERY_RULES });
    setResult(nextResult);
    setRolling(true);
    setRevealCount(0);

    const totalSteps = NHL_LOTTERY_RULES.drawCount + nextResult.finalOrder.length;
    for (let step = 1; step <= totalSteps; step += 1) {
      const timer = setTimeout(() => {
        setRevealCount(step);
        if (step === totalSteps) {
          setRolling(false);
        }
      }, step * 160);
      timersRef.current.push(timer);
    }

    setHistory((prev) => [nextResult, ...prev].slice(0, 8));
  }

  function resetSimulation() {
    clearTimers();
    setResult(null);
    setRevealCount(0);
    setRolling(false);
    setSummary(null);
  }

  function runSummaryMode() {
    if (!hasEntries) return;
    startTransition(() => {
      const seed = seedInput.trim() ? Number(seedInput.trim()) : Date.now();
      const nextSummary = simulateManyLotteries(entries, NHL_LOTTERY_RULES.summarySimulationCount, {
        seed,
        config: NHL_LOTTERY_RULES,
      });
      setSummary(nextSummary);
    });
  }

  const visibleWinners = result ? result.winners.slice(0, Math.max(0, revealCount)) : [];
  const visibleOrder = result
    ? result.finalOrder.slice(0, Math.max(0, revealCount - NHL_LOTTERY_RULES.drawCount))
    : [];
  const resolvedDraftOrder = useMemo(() => {
    const lotteryOrder = (result?.finalOrder || baseOrder).map((entry) => entry.originalTeam);
    return resolve2026FirstRoundOrder({
      lotteryOrder,
      nonLotteryOrder,
      pickLedger,
    });
  }, [baseOrder, nonLotteryOrder, pickLedger, result]);
  const resolvedByOriginalTeam = useMemo(
    () => Object.fromEntries(resolvedDraftOrder.map((row) => [row.originalTeam, row])),
    [resolvedDraftOrder]
  );
  const ottawaRow = resolvedDraftOrder.find((row) => row.originalTeam === "OTT");
  const normalResolvedRows = resolvedDraftOrder.filter((row) => row.originalTeam !== "OTT");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top left, #0d2136 0%, #060a11 58%, #05090f 100%)",
        padding: "36px 20px 64px",
      }}
    >
      <style>{`
        .lottery-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(340px, 0.9fr);
          gap: 18px;
        }
        .lottery-table-row:hover {
          background: #0f1722;
        }
        .lottery-button:hover {
          transform: translateY(-1px);
          box-shadow: 0 10px 24px rgba(27, 188, 255, 0.18);
        }
        .lottery-ownership-row:hover {
          background: #101925;
        }
        .lottery-tooltip:hover .lottery-tooltip-panel {
          opacity: 1 !important;
          transform: translateX(-50%) translateY(-4px) !important;
        }
        @media (max-width: 980px) {
          .lottery-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 760px) {
          .lottery-hero-meta,
          .lottery-controls-row,
          .lottery-results-grid,
          .lottery-summary-grid {
            grid-template-columns: 1fr !important;
          }
          .lottery-table-head {
            display: none !important;
          }
          .lottery-table-row {
            grid-template-columns: 1fr !important;
            gap: 12px !important;
          }
        }
      `}</style>

      <div style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gap: 18 }}>
        <section
          style={{
            border: "1px solid #18304a",
            borderRadius: 28,
            background: "linear-gradient(180deg, rgba(10,20,32,0.98) 0%, rgba(7,11,18,0.98) 100%)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "28px 28px 24px", display: "grid", gap: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "start", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 11, color: "#4d82af", fontFamily: "'DM Mono',monospace", letterSpacing: "0.16em", textTransform: "uppercase" }}>
                  NHL Analytics · Draft Tools
                </div>
                <h1 style={{ margin: 0, color: "#eff8ff", fontSize: 46, lineHeight: 0.95, letterSpacing: "-0.04em", fontWeight: 900 }}>
                  NHL Draft Lottery Simulator
                </h1>
                <p style={{ margin: 0, maxWidth: 800, color: "#86a5c0", fontSize: 18, lineHeight: 1.35 }}>
                  Simulate the NHL lottery using configurable weighted odds and movement rules. The engine is already structured for future traded picks and protected pick logic.
                </p>
              </div>
              <div
                style={{
                  border: "1px solid #1f5b85",
                  borderRadius: 18,
                  padding: "14px 18px",
                  minWidth: 188,
                  background: "rgba(10, 35, 56, 0.45)",
                }}
              >
                <div style={{ fontSize: 11, color: "#6cbef1", fontFamily: "'DM Mono',monospace", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                  Live order snapshot
                </div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#eaf7ff", marginTop: 4 }}>
                  {NHL_LOTTERY_RULES.lotteryTeamCount} lottery teams
                </div>
                <div style={{ fontSize: 12, color: "#6d859e", marginTop: 4 }}>
                  Generated {generatedAt}
                </div>
              </div>
            </div>

            <div className="lottery-hero-meta" style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16 }}>
              <div style={{ border: "1px solid #172534", borderRadius: 18, background: "#0b1118", padding: 18 }}>
                <div style={{ fontSize: 11, color: "#5c7a98", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
                  Rules & assumptions
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {LOTTERY_ASSUMPTIONS.map((item) => (
                    <div key={item} style={{ color: "#d6e9f7", fontSize: 14, lineHeight: 1.35 }}>
                      {item}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ border: "1px solid #172534", borderRadius: 18, background: "#0b1118", padding: 18 }}>
                <div style={{ fontSize: 11, color: "#5c7a98", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
                  Config
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {[
                    ["Lottery draws", NHL_LOTTERY_RULES.drawCount],
                    ["Max jump", `${NHL_LOTTERY_RULES.maxJump} spots`],
                    ["Summary mode", `${NHL_LOTTERY_RULES.summarySimulationCount} sims`],
                    ["Seeded RNG", "Optional"],
                  ].map(([label, value]) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, paddingBottom: 8, borderBottom: "1px solid #16202c" }}>
                      <span style={{ color: "#839ab1", fontSize: 14 }}>{label}</span>
                      <span style={{ color: "#f0f7fd", fontSize: 14, fontWeight: 700 }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="lottery-grid">
          <section
            style={{
              border: "1px solid #17283b",
              borderRadius: 24,
              background: "#091017",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "18px 20px 12px", borderBottom: "1px solid #132131" }}>
              <div style={{ fontSize: 11, color: "#5e7b98", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Lottery table
              </div>
              <div style={{ fontSize: 28, color: "#f0f8ff", fontWeight: 900, marginTop: 4 }}>
                Current lottery-eligible order
              </div>
            </div>

            <div className="lottery-table-head" style={{ display: "grid", gridTemplateColumns: "56px minmax(210px, 1fr) 116px 136px 126px", gap: 12, padding: "10px 20px", borderBottom: "1px solid #132131", color: "#4a6987", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              <div>Rank</div>
              <div>Original team</div>
              <div>Odds</div>
              <div>Projection</div>
              <div>Points</div>
            </div>

            <div style={{ display: "grid" }}>
              {baseOrder.length === 0 ? (
                <div style={{ padding: "20px", color: "#86a5c0", fontSize: 14 }}>
                  No live lottery teams available right now.
                </div>
              ) : baseOrder.map((entry) => {
                const simRow = result?.finalOrder.find((row) => row.pickId === entry.pickId);
                const projected = simRow?.finalPick ?? entry.projectedPick;
                const meta = movementMeta(entry.baseRank - projected);
                const resolvedPick = resolvedByOriginalTeam[entry.originalTeam];
                const conditionNote = resolvedPick
                  ? [
                      resolvedPick.notes,
                      ...resolvedPick.conditionResults.map((item) =>
                        `${item.triggered ? "Triggered" : "Checked"}: ${item.description}`
                      ),
                    ]
                      .filter(Boolean)
                      .join(" | ")
                  : "";
                return (
                  <div
                    key={entry.pickId}
                    className="lottery-table-row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "56px minmax(210px, 1fr) 116px 136px 126px",
                      gap: 12,
                      alignItems: "center",
                      padding: "14px 20px",
                      borderBottom: "1px solid #111b28",
                      transition: "background 0.16s ease",
                    }}
                    >
                    <div style={{ fontSize: 14, color: "#9dc5e6", fontWeight: 700 }}>{entry.baseRank}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                      <PickOwnershipCluster
                        originalTeam={entry.originalTeam}
                        selectionOwner={resolvedPick?.selectionOwner || entry.originalTeam}
                        isProtected={resolvedPick?.protectionTriggered}
                        note={conditionNote}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 16, color: "#ecf7ff", fontWeight: 800, lineHeight: 1.1 }}>
                          {entry.standings.name}
                        </div>
                        <div style={{ fontSize: 11, color: "#5d7994", fontFamily: "'DM Mono',monospace", marginTop: 4 }}>
                          {resolvedPick?.selectionOwner && resolvedPick.selectionOwner !== entry.originalTeam
                            ? `${entry.originalTeam} · selects to ${resolvedPick.selectionOwner}`
                            : entry.originalTeam}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 15, color: "#c9d8e5", fontWeight: 700 }}>{formatPercent(entry.odds)}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "#edf7ff", fontSize: 15, fontWeight: 800 }}>#{projected}</span>
                      <span style={{ color: meta.color, fontSize: 11, fontFamily: "'DM Mono',monospace" }}>{meta.symbol}</span>
                    </div>
                    <div style={{ fontSize: 14, color: "#90a6bc" }}>{entry.standings.points}</div>
                  </div>
                );
              })}
            </div>
          </section>

          <section style={{ display: "grid", gap: 18 }}>
            <div
              style={{
                border: "1px solid #17283b",
                borderRadius: 24,
                background: "#091017",
                padding: 20,
                display: "grid",
                gap: 14,
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: "#5e7b98", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  Controls
                </div>
                <div style={{ fontSize: 24, color: "#eff8ff", fontWeight: 900, marginTop: 4 }}>
                  Run the lottery
                </div>
              </div>

              <div className="lottery-controls-row" style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 10 }}>
                <input
                  value={seedInput}
                  onChange={(event) => setSeedInput(event.target.value)}
                  placeholder="Optional seed for reproducibility"
                  style={{
                    background: "#0f1823",
                    border: "1px solid #1d3448",
                    borderRadius: 14,
                    color: "#e9f6ff",
                    padding: "13px 14px",
                    outline: "none",
                    fontSize: 14,
                    minWidth: 0,
                  }}
                />
                <button
                  type="button"
                  onClick={runSimulation}
                  className="lottery-button"
                  disabled={!hasEntries}
                  style={{
                    borderRadius: 14,
                    border: "1px solid #1bbcff",
                    background: "linear-gradient(180deg,#11bfff 0%,#0d8fe1 100%)",
                    color: "#04121d",
                    fontWeight: 800,
                    fontSize: 13,
                    padding: "12px 14px",
                    cursor: hasEntries ? "pointer" : "not-allowed",
                    opacity: hasEntries ? 1 : 0.45,
                    transition: "transform 0.16s ease, box-shadow 0.16s ease",
                    whiteSpace: "nowrap",
                  }}
                >
                  {result ? "Sim Lottery Again" : "Sim Lottery"}
                </button>
                <button
                  type="button"
                  onClick={runSummaryMode}
                  className="lottery-button"
                  disabled={!hasEntries}
                  style={{
                    borderRadius: 14,
                    border: "1px solid #20374d",
                    background: "#111a23",
                    color: "#e8f5ff",
                    fontWeight: 800,
                    fontSize: 13,
                    padding: "12px 14px",
                    cursor: hasEntries ? "pointer" : "not-allowed",
                    opacity: hasEntries ? 1 : 0.45,
                    transition: "transform 0.16s ease, box-shadow 0.16s ease",
                    whiteSpace: "nowrap",
                  }}
                >
                  Run 100 Sims
                </button>
                <button
                  type="button"
                  onClick={resetSimulation}
                  className="lottery-button"
                  style={{
                    borderRadius: 14,
                    border: "1px solid #20374d",
                    background: "#111a23",
                    color: "#e8f5ff",
                    fontWeight: 800,
                    fontSize: 13,
                    padding: "12px 14px",
                    cursor: "pointer",
                    transition: "transform 0.16s ease, box-shadow 0.16s ease",
                    whiteSpace: "nowrap",
                  }}
                >
                  Reset
                </button>
              </div>

              <div style={{ fontSize: 12, color: "#6f879f", lineHeight: 1.45 }}>
                The engine uses weighted lottery odds with a configurable max jump. Future traded-pick and protected-pick logic should plug into the ownership resolution layer before simulation.
              </div>
              {!hasEntries && (
                <div style={{ fontSize: 13, color: "#ff9aa4" }}>
                  Live standings were unavailable, so the simulator could not build the current lottery field.
                </div>
              )}
              {rolling && (
                <div style={{ fontSize: 11, color: "#7bcfff", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Revealing results…
                </div>
              )}
            </div>

            <div
              style={{
                border: "1px solid #17283b",
                borderRadius: 24,
                background: "#091017",
                padding: 20,
                display: "grid",
                gap: 16,
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: "#5e7b98", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  Results
                </div>
                <div style={{ fontSize: 24, color: "#eff8ff", fontWeight: 900, marginTop: 4 }}>
                  {result ? "Latest simulation" : "Waiting for first sim"}
                </div>
              </div>

              {!result ? (
                <div style={{ color: "#7e98b1", fontSize: 14, lineHeight: 1.45 }}>
                  Run the simulator to reveal the lottery winners, movement badges, and the final draft order. The top two picks are revealed first, then the rest of the board settles into place.
                </div>
              ) : (
                <>
                  <div className="lottery-results-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {Array.from({ length: NHL_LOTTERY_RULES.drawCount }).map((_, index) => {
                      const winner = visibleWinners[index];
                      return (
                        <div
                          key={index}
                          style={{
                            border: "1px solid #183247",
                            borderRadius: 16,
                            background: winner ? "linear-gradient(180deg, rgba(16, 62, 98, 0.5) 0%, rgba(10, 18, 27, 0.9) 100%)" : "#0e1620",
                            minHeight: 108,
                            padding: 16,
                            display: "grid",
                            alignContent: "space-between",
                            gap: 10,
                          }}
                        >
                          <div style={{ fontSize: 11, color: "#66a9d9", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                            Lottery draw {index + 1}
                          </div>
                          {winner ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <TeamLogo abbr={winner.currentOwner} size={40} />
                              <div>
                                <div style={{ color: "#f1f9ff", fontSize: 19, fontWeight: 900 }}>
                                  {winner.standings.name}
                                </div>
                                <div style={{ color: "#86c9f4", fontSize: 13 }}>
                                  Wins pick #{winner.wonPick}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div style={{ color: "#65819e", fontSize: 14 }}>Revealing…</div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ fontSize: 12, color: "#7d95ab", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      Simulated top order
                    </div>
                    {visibleOrder.map((row) => (
                      (() => {
                        const resolvedPick = resolvedDraftOrder.find((pick) => pick.originalTeam === row.originalTeam);
                        const selectionOwner = resolvedPick?.selectionOwner || row.currentOwner;
                        const ownerChanged = selectionOwner !== row.originalTeam;
                        const conditionNote = resolvedPick
                          ? [
                              resolvedPick.notes,
                              ...resolvedPick.conditionResults.map((item) =>
                                `${item.triggered ? "Triggered" : "Checked"}: ${item.description}`
                              ),
                            ]
                              .filter(Boolean)
                              .join(" | ")
                          : "";
                        return (
                          <div
                            key={row.pickId}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "48px minmax(0, 1fr) auto",
                              gap: 12,
                              alignItems: "center",
                              padding: "12px 14px",
                              borderRadius: 16,
                              background: "#0e1620",
                              border: "1px solid #182736",
                            }}
                          >
                            <div style={{ color: "#b6d7f1", fontSize: 18, fontWeight: 900 }}>#{row.finalPick}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                              <PickOwnershipCluster
                                originalTeam={row.originalTeam}
                                selectionOwner={selectionOwner}
                                isProtected={resolvedPick?.protectionTriggered}
                                note={conditionNote}
                              />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ color: "#eff8ff", fontSize: 15, fontWeight: 800 }}>{row.standings.name}</div>
                                <div style={{ color: "#63839f", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
                                  Original team · started #{row.baseRank}
                                </div>
                                <div style={{ color: ownerChanged ? "#35e3a0" : "#7d95ab", fontSize: 11, fontFamily: "'DM Mono',monospace", marginTop: 4 }}>
                                  Selection owner: {selectionOwner}
                                  {resolvedPick?.protectionTriggered ? " · protection triggered" : ""}
                                  {resolvedPick?.requiresManualReview ? " · manual review" : ""}
                                </div>
                              </div>
                            </div>
                            <ResultBadge row={row} />
                          </div>
                        );
                      })()
                    ))}
                  </div>
                </>
              )}
            </div>

            <div
              style={{
                border: "1px solid #17283b",
                borderRadius: 24,
                background: "#091017",
                padding: 20,
                display: "grid",
                gap: 16,
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: "#5e7b98", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  2026 Pick Ownership
                </div>
                <div style={{ fontSize: 24, color: "#eff8ff", fontWeight: 900, marginTop: 4 }}>
                  Resolved first-round order
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <LegendPill label="Original Team" color="#9dc5e6" bg="rgba(157, 197, 230, 0.12)" />
                <LegendPill label="Selection Owner" color="#35e3a0" bg="rgba(53, 227, 160, 0.12)" />
                <LegendPill label="Protected Pick" color="#ff7c8d" bg="rgba(255, 111, 123, 0.12)" />
                <LegendPill label="Static Slot" color="#8ed0ff" bg="rgba(74, 167, 255, 0.12)" />
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {normalResolvedRows.map((row) => {
                  const meta = ownershipMeta(row);
                  const conditionNote = row.conditionResults
                    .map((item) => `${item.triggered ? "Triggered" : "Checked"}: ${item.description}`)
                    .join(" | ");
                  return (
                    <div
                      key={row.assetId}
                      className="lottery-ownership-row"
                      title={conditionNote || row.notes || ""}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "52px minmax(0, 1fr) minmax(0, 1fr) auto",
                        gap: 12,
                        alignItems: "center",
                        padding: "12px 14px",
                        borderRadius: 16,
                        background: "#0e1620",
                        border: "1px solid #182736",
                        transition: "background 0.16s ease",
                      }}
                    >
                      <div style={{ color: "#b6d7f1", fontSize: 18, fontWeight: 900 }}>#{row.slot}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: "#6d87a0", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          Original Team
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 5 }}>
                          <div style={{ opacity: row.selectionOwner !== row.originalTeam ? 0.4 : 1, filter: row.selectionOwner !== row.originalTeam ? "grayscale(0.7)" : "none" }}>
                            <TeamLogo abbr={row.originalTeam} size={28} />
                          </div>
                          <div style={{ color: "#eff8ff", fontSize: 15, fontWeight: 800 }}>{row.originalTeam}</div>
                          <ConditionTooltip note={conditionNote || row.notes || ""} />
                        </div>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: "#6d87a0", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          Selection Owner
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 5 }}>
                          <TeamLogo abbr={row.selectionOwner} size={28} />
                          <div style={{ color: "#eff8ff", fontSize: 15, fontWeight: 800 }}>{row.selectionOwner}</div>
                        </div>
                      </div>
                      <div style={{ display: "grid", justifyItems: "end", gap: 8 }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "4px 9px",
                            borderRadius: 999,
                            background: meta.bg,
                            color: meta.color,
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            fontFamily: "'DM Mono',monospace",
                          }}
                        >
                          {meta.label}
                        </span>
                        <div style={{ color: "#6d87a0", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
                          {row.isTradedPick ? "Traded" : "Own pick"}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {ottawaRow && (
                  <div
                    title={ottawaRow.notes || ottawaRow.conditionResults.map((item) => item.description).join(" | ")}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "52px minmax(0, 1fr) minmax(0, 1fr) auto",
                      gap: 12,
                      alignItems: "center",
                      padding: "14px 16px",
                      borderRadius: 18,
                      background: "linear-gradient(180deg, rgba(17, 88, 140, 0.28) 0%, rgba(10, 18, 27, 0.95) 100%)",
                      border: "1px solid #246ea7",
                    }}
                  >
                    <div style={{ color: "#d4ecff", fontSize: 20, fontWeight: 900 }}>#{ottawaRow.slot}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: "#7fc5fb", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        Special Slot
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 5 }}>
                        <TeamLogo abbr={ottawaRow.originalTeam} size={30} />
                        <div style={{ color: "#f3fbff", fontSize: 16, fontWeight: 900 }}>Ottawa static pick</div>
                      </div>
                    </div>
                    <div style={{ color: "#d8ebfb", fontSize: 14 }}>
                      Original team and selection owner: <strong>{ottawaRow.selectionOwner}</strong>
                    </div>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 10px",
                        borderRadius: 999,
                        background: "rgba(142, 208, 255, 0.16)",
                        color: "#8ed0ff",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        fontFamily: "'DM Mono',monospace",
                      }}
                    >
                      Static slot 32
                    </span>
                  </div>
                )}
              </div>
            </div>

            {summary && (
              <div
                style={{
                  border: "1px solid #17283b",
                  borderRadius: 24,
                  background: "#091017",
                  padding: 20,
                  display: "grid",
                  gap: 14,
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: "#5e7b98", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    Summary mode
                  </div>
                  <div style={{ fontSize: 24, color: "#eff8ff", fontWeight: 900, marginTop: 4 }}>
                    {NHL_LOTTERY_RULES.summarySimulationCount} simulation snapshot
                  </div>
                </div>
                <div className="lottery-summary-grid" style={{ display: "grid", gap: 10 }}>
                  {summary.slice(0, 8).map((team) => (
                    <div
                      key={team.pickId}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) 88px 88px 88px",
                        gap: 12,
                        alignItems: "center",
                        padding: "12px 14px",
                        borderRadius: 16,
                        background: "#0e1620",
                        border: "1px solid #182736",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                        <TeamLogo abbr={team.currentOwner} size={28} />
                        <div>
                          <div style={{ color: "#eff8ff", fontSize: 15, fontWeight: 800 }}>{team.standings.name}</div>
                          <div style={{ color: "#63839f", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
                            Base #{team.baseRank}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: "#eff8ff", fontSize: 15, fontWeight: 800 }}>{formatPercent(team.topPickRate)}</div>
                        <div style={{ color: "#63839f", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>1st pick</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: "#eff8ff", fontSize: 15, fontWeight: 800 }}>{formatPercent(team.topThreeRate)}</div>
                        <div style={{ color: "#63839f", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>Top 3</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: "#eff8ff", fontSize: 15, fontWeight: 800 }}>{team.averagePick.toFixed(2)}</div>
                        <div style={{ color: "#63839f", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>Avg pick</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              style={{
                border: "1px solid #17283b",
                borderRadius: 24,
                background: "#091017",
                padding: 20,
                display: "grid",
                gap: 12,
              }}
            >
              <div style={{ fontSize: 11, color: "#5e7b98", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                History
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {history.length === 0 ? (
                  <div style={{ color: "#72889d", fontSize: 14 }}>
                    No simulation history yet.
                  </div>
                ) : (
                  history.map((item, index) => <HistoryRow key={`${item.seed}-${index}`} item={item} index={index} />)
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
