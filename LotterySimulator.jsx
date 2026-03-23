"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { LOTTERY_ASSUMPTIONS, NHL_LOTTERY_RULES } from "@/app/lib/lotteryConfig";
import { simulateLottery, simulateManyLotteries } from "@/app/lib/lotteryEngine";
import { logoUrl } from "@/app/lib/nhlTeams";
import { resolve2026FirstRoundOrder } from "@/app/lib/lotteryResolver";

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatPointPct(value) {
  const pct = Number(value || 0);
  const display = pct <= 1 ? pct.toFixed(3).replace(/^0/, "") : (pct / 100).toFixed(3).replace(/^0/, "");
  return display;
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

function mostCommonSlot(finishes = []) {
  let bestIndex = -1;
  let bestValue = -1;
  finishes.forEach((value, index) => {
    if (value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  });
  return bestIndex >= 0 ? bestIndex + 1 : null;
}

function RevealWinnerCard({ title, winner, displayTeam, movement, visible }) {
  const accent = winner ? movementMeta(movement).color : "#2fb4ff";
  return (
    <div
      style={{
        width: "min(560px, calc(100vw - 40px))",
        borderRadius: 28,
        border: `1px solid ${accent}55`,
        background: "linear-gradient(180deg, rgba(12,19,29,0.98) 0%, rgba(7,11,18,0.98) 100%)",
        boxShadow: `0 24px 70px rgba(0,0,0,0.45), 0 0 80px ${accent}22`,
        padding: "26px 24px 24px",
        display: "grid",
        gap: 18,
        transform: visible ? "scale(1)" : "scale(0.96)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.18s ease, transform 0.18s ease",
      }}
    >
      <div style={{ textAlign: "center", display: "grid", gap: 8 }}>
        <div style={{ color: "#6caede", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.16em" }}>
          {title}
        </div>
        <div style={{ color: "#eff8ff", fontSize: 20, fontWeight: 900 }}>
          Lottery draw in progress
        </div>
      </div>

      <div
        style={{
          display: "grid",
          justifyItems: "center",
          gap: 14,
          padding: "20px 10px 14px",
          borderRadius: 22,
          background: "radial-gradient(circle at center, rgba(47,180,255,0.16) 0%, rgba(47,180,255,0) 68%)",
        }}
      >
        <div
          style={{
            width: 144,
            height: 144,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            border: `1px solid ${accent}66`,
            background: `${accent}14`,
            boxShadow: winner ? `0 0 0 12px ${accent}10, 0 0 48px ${accent}30` : "none",
          }}
        >
          <TeamLogo abbr={displayTeam || winner?.currentOwner || winner?.originalTeam} size={96} />
        </div>
        {winner ? (
          <>
            <div style={{ color: "#f5fbff", fontSize: 34, fontWeight: 900, textAlign: "center", lineHeight: 1 }}>
              {winner.standings?.name || winner.currentOwner}
            </div>
            <div style={{ color: accent, fontSize: 17, fontWeight: 800, textAlign: "center" }}>
              {winner.standings?.name || winner.currentOwner} wins Pick #{winner.wonPick}
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 999,
                background: `${accent}18`,
                color: accent,
                fontSize: 12,
                fontWeight: 800,
                fontFamily: "'DM Mono',monospace",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {movement > 0 ? `+${movement}` : movement === 0 ? "No jump" : `${movement}`}
            </div>
          </>
        ) : (
          <div style={{ color: "#88a7c0", fontSize: 14, fontFamily: "'DM Mono',monospace" }}>
            Cycling through eligible teams…
          </div>
        )}
      </div>
    </div>
  );
}

function LotteryRevealOverlay({ stage, drawTitle, winner, displayTeam, movement, onSkip }) {
  if (!stage) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        display: "grid",
        placeItems: "center",
        background: "rgba(2, 7, 12, 0.74)",
        backdropFilter: "blur(10px)",
        padding: 20,
      }}
    >
      <div style={{ position: "absolute", top: 18, right: 18 }}>
        <button
          type="button"
          onClick={onSkip}
          style={{
            borderRadius: 999,
            border: "1px solid #29455f",
            background: "#0e1722",
            color: "#cbe5f8",
            padding: "9px 12px",
            fontSize: 11,
            fontWeight: 800,
            fontFamily: "'DM Mono',monospace",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            cursor: "pointer",
          }}
        >
          Skip reveal
        </button>
      </div>
      <RevealWinnerCard
        title={drawTitle}
        winner={winner}
        displayTeam={displayTeam}
        movement={movement}
        visible
      />
    </div>
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

function buildPickTooltip(asset, resolvedPick) {
  if (!asset && !resolvedPick) return "";
  const descriptions = (asset?.conditions || [])
    .map((condition) => condition.description)
    .filter(Boolean);

  if (descriptions.length > 0) {
    return descriptions.join(" | ");
  }
  if (resolvedPick?.isStaticSlot) {
    return `Static slot at #${resolvedPick.slot}`;
  }
  if (resolvedPick?.selectionOwner && resolvedPick.selectionOwner !== resolvedPick.originalTeam) {
    return `Selection owned by ${resolvedPick.selectionOwner}`;
  }
  return "";
}

export default function LotterySimulator({ initialEntries, nonLotteryOrder, pickLedger, generatedAt }) {
  const [entries] = useState(initialEntries);
  const [mode, setMode] = useState("reveal");
  const [result, setResult] = useState(null);
  const [boardVisible, setBoardVisible] = useState(false);
  const [overlayStage, setOverlayStage] = useState(null);
  const [overlayDisplayTeam, setOverlayDisplayTeam] = useState(null);
  const [history, setHistory] = useState([]);
  const [seedInput, setSeedInput] = useState("");
  const [summary, setSummary] = useState(null);
  const timersRef = useRef([]);
  const intervalsRef = useRef([]);

  const baseOrder = useMemo(() => [...entries].sort((a, b) => a.baseRank - b.baseRank), [entries]);
  const hasEntries = baseOrder.length > 0;

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      intervalsRef.current.forEach((timer) => clearInterval(timer));
      timersRef.current = [];
      intervalsRef.current = [];
    };
  }, []);

  function clearTimers() {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    intervalsRef.current.forEach((timer) => clearInterval(timer));
    timersRef.current = [];
    intervalsRef.current = [];
  }

  function teamsEligibleForPick(targetPick, drawnWinners = []) {
    const taken = new Set(drawnWinners.map((item) => item.pickId));
    return baseOrder
      .filter((entry) => !taken.has(entry.pickId))
      .filter((entry) => entry.baseRank - targetPick <= NHL_LOTTERY_RULES.maxJump)
      .map((entry) => entry.currentOwner || entry.originalTeam);
  }

  function startDrawAnimation(targetPick, winner, priorWinners = [], onComplete) {
    const teams = teamsEligibleForPick(targetPick, priorWinners);
    let step = 0;
    setOverlayStage({ pick: targetPick, winner: null });
    setOverlayDisplayTeam(teams[0] || winner.currentOwner || winner.originalTeam);

    const fastInterval = setInterval(() => {
      step += 1;
      setOverlayDisplayTeam(teams[step % Math.max(teams.length, 1)] || winner.currentOwner || winner.originalTeam);
    }, 85);
    intervalsRef.current.push(fastInterval);

    const slowTimer = setTimeout(() => {
      clearInterval(fastInterval);
      const slowInterval = setInterval(() => {
        step += 1;
        setOverlayDisplayTeam(teams[step % Math.max(teams.length, 1)] || winner.currentOwner || winner.originalTeam);
      }, 170);
      intervalsRef.current.push(slowInterval);

      const stopTimer = setTimeout(() => {
        clearInterval(slowInterval);
        setOverlayDisplayTeam(winner.currentOwner || winner.originalTeam);
        setOverlayStage({ pick: targetPick, winner });
        const completeTimer = setTimeout(() => {
          onComplete?.();
        }, 550);
        timersRef.current.push(completeTimer);
      }, 520);
      timersRef.current.push(stopTimer);
    }, 1120);
    timersRef.current.push(slowTimer);
  }

  function runSimulation() {
    if (!hasEntries) return;
    clearTimers();
    setMode("reveal");
    setSummary(null);
    const seed = seedInput.trim() ? Number(seedInput.trim()) : Date.now();
    const nextResult = simulateLottery(entries, { seed, config: NHL_LOTTERY_RULES });
    setResult(nextResult);
    setBoardVisible(false);
    setOverlayStage(null);
    setOverlayDisplayTeam(null);

    const pickTwoWinner = nextResult.winners.find((winner) => winner.wonPick === 2);
    const pickOneWinner = nextResult.winners.find((winner) => winner.wonPick === 1);

    if (pickTwoWinner) {
      startDrawAnimation(2, pickTwoWinner, [], () => {
        if (pickOneWinner) {
          const transitionTimer = setTimeout(() => {
            startDrawAnimation(1, pickOneWinner, [pickTwoWinner], () => {
              const settleTimer = setTimeout(() => {
                setOverlayStage(null);
                setBoardVisible(true);
              }, 260);
              timersRef.current.push(settleTimer);
            });
          }, 180);
          timersRef.current.push(transitionTimer);
        } else {
          setOverlayStage(null);
          setBoardVisible(true);
        }
      });
    } else {
      setBoardVisible(true);
    }

    setHistory((prev) => [nextResult, ...prev].slice(0, 8));
  }

  function resetSimulation() {
    clearTimers();
    setResult(null);
    setBoardVisible(false);
    setOverlayStage(null);
    setOverlayDisplayTeam(null);
    setSummary(null);
  }

  function runSummaryMode() {
    if (!hasEntries) return;
    clearTimers();
    setMode("summary");
    setResult(null);
    setBoardVisible(false);
    setOverlayStage(null);
    setOverlayDisplayTeam(null);
    startTransition(() => {
      const seed = seedInput.trim() ? Number(seedInput.trim()) : Date.now();
      const nextSummary = simulateManyLotteries(entries, NHL_LOTTERY_RULES.summarySimulationCount, {
        seed,
        config: NHL_LOTTERY_RULES,
      });
      setSummary(nextSummary);
    });
  }

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
  const assetByOriginalTeam = useMemo(
    () => Object.fromEntries((pickLedger || []).map((asset) => [asset.originalTeam, asset])),
    [pickLedger]
  );
  const ottawaRow = resolvedDraftOrder.find((row) => row.originalTeam === "OTT");
  const normalResolvedRows = resolvedDraftOrder.filter((row) => row.originalTeam !== "OTT");
  const latestPickOneWinner = result?.winners.find((winner) => winner.wonPick === 1) || null;
  const latestPickTwoWinner = result?.winners.find((winner) => winner.wonPick === 2) || null;

  function skipReveal() {
    clearTimers();
    setOverlayStage(null);
    setOverlayDisplayTeam(null);
    setBoardVisible(true);
  }

  return (
    <div
      className="lottery-page-shell"
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
        .lottery-board-row {
          transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms ease, border-color 180ms ease, background 180ms ease;
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
        .lottery-ghost-row {
          opacity: 0.42;
        }
        @media (max-width: 980px) {
          .lottery-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 760px) {
          .lottery-page-shell {
            padding: 18px 12px 36px !important;
          }
          .lottery-hero-meta,
          .lottery-controls-row,
          .lottery-results-grid,
          .lottery-summary-grid {
            grid-template-columns: 1fr !important;
          }
          .lottery-hero-title {
            font-size: 34px !important;
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

      <LotteryRevealOverlay
        stage={overlayStage}
        drawTitle={overlayStage ? `Pick #${overlayStage.pick} reveal` : ""}
        winner={overlayStage?.winner || null}
        displayTeam={overlayDisplayTeam}
        movement={overlayStage?.winner?.moved ?? 0}
        onSkip={skipReveal}
      />

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
                <h1 className="lottery-hero-title" style={{ margin: 0, color: "#eff8ff", fontSize: 46, lineHeight: 0.95, letterSpacing: "-0.04em", fontWeight: 900 }}>
                  NHL Draft Lottery Simulator
                </h1>
                <p style={{ margin: 0, maxWidth: 800, color: "#86a5c0", fontSize: 18, lineHeight: 1.35 }}>
                  Run a dramatic reveal or switch to analytics mode for broader outcome distributions. The simulator keeps your current weighted odds, jump rules, and ownership logic intact.
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
                <details>
                  <summary style={{ cursor: "pointer", color: "#d6e9f7", fontSize: 14, fontWeight: 700, listStyle: "none" }}>
                    View current lottery assumptions
                  </summary>
                  <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                    {LOTTERY_ASSUMPTIONS.map((item) => (
                      <div key={item} style={{ color: "#d6e9f7", fontSize: 14, lineHeight: 1.35 }}>
                        {item}
                      </div>
                    ))}
                  </div>
                </details>
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

            <div className="lottery-table-head" style={{ display: "grid", gridTemplateColumns: "56px minmax(280px, 1.2fr) 92px 92px 92px 116px 92px", gap: 12, padding: "10px 20px", borderBottom: "1px solid #132131", color: "#4a6987", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              <div>Rank</div>
              <div>Original team</div>
              <div>GP</div>
              <div>P%</div>
              <div>L10</div>
              <div>Odds</div>
              <div>Projection</div>
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
                const asset = assetByOriginalTeam[entry.originalTeam];
                const conditionNote = buildPickTooltip(asset, resolvedPick);
                return (
                  <div
                    key={entry.pickId}
                    className="lottery-table-row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "56px minmax(280px, 1.2fr) 92px 92px 92px 116px 92px",
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
                    <div style={{ fontSize: 14, color: "#c9d8e5", fontWeight: 700 }}>{entry.standings.gamesPlayed}</div>
                    <div style={{ fontSize: 14, color: "#c9d8e5", fontWeight: 700 }}>{formatPointPct(entry.standings.pointPct)}</div>
                    <div style={{ fontSize: 14, color: "#90a6bc", fontWeight: 700 }}>{entry.standings.last10Record || "—"}</div>
                    <div style={{ fontSize: 15, color: "#c9d8e5", fontWeight: 700 }}>{formatPercent(entry.odds)}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "#edf7ff", fontSize: 15, fontWeight: 800 }}>#{projected}</span>
                      <span style={{ color: meta.color, fontSize: 11, fontFamily: "'DM Mono',monospace" }}>{meta.symbol}</span>
                    </div>
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
                  Choose a mode
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  { key: "reveal", label: "Lottery Reveal Mode" },
                  { key: "summary", label: "Summary Simulation Mode" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setMode(item.key)}
                    style={{
                      borderRadius: 999,
                      border: `1px solid ${mode === item.key ? "#2fb4ff" : "#20374d"}`,
                      background: mode === item.key ? "rgba(47,180,255,0.16)" : "#111a23",
                      color: mode === item.key ? "#cfeeff" : "#8ca8c1",
                      fontWeight: 800,
                      fontSize: 12,
                      padding: "9px 12px",
                      cursor: "pointer",
                      fontFamily: "'DM Mono',monospace",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {item.label}
                  </button>
                ))}
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
                  {result && mode === "reveal" ? "Reveal Again" : "Reveal Lottery"}
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
                  Analytics Mode · 100 Sims
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
                Reveal mode is built for one dramatic run. Summary mode is for repeated simulations and aggregate landing spots. The engine underneath is the same in both cases.
              </div>
              {!hasEntries && (
                <div style={{ fontSize: 13, color: "#ff9aa4" }}>
                  Live standings were unavailable, so the simulator could not build the current lottery field.
                </div>
              )}
              {overlayStage && mode === "reveal" && (
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
                  {mode === "summary" ? "Summary simulation" : result ? "Latest lottery reveal" : "Waiting for first reveal"}
                </div>
              </div>

              {mode === "summary" ? (
                summary ? (
                  <div className="lottery-summary-grid" style={{ display: "grid", gap: 10 }}>
                    {summary.map((team) => {
                      const commonSlot = mostCommonSlot(team.finishes);
                      const topTwoRate = ((team.finishes.slice(0, 2).reduce((sum, value) => sum + value, 0) / NHL_LOTTERY_RULES.summarySimulationCount) * 100);
                      return (
                        <div
                          key={team.pickId}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 1.2fr) repeat(4, minmax(72px, 96px))",
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
                            <div style={{ color: "#63839f", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>Pick #1</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ color: "#eff8ff", fontSize: 15, fontWeight: 800 }}>{formatPercent(topTwoRate)}</div>
                            <div style={{ color: "#63839f", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>Top 2</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ color: "#eff8ff", fontSize: 15, fontWeight: 800 }}>{team.averagePick.toFixed(2)}</div>
                            <div style={{ color: "#63839f", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>Avg slot</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ color: "#eff8ff", fontSize: 15, fontWeight: 800 }}>{commonSlot ? `#${commonSlot}` : "—"}</div>
                            <div style={{ color: "#63839f", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>Most common</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    style={{
                      borderRadius: 18,
                      border: "1px dashed #244158",
                      background: "#0d1620",
                      padding: "22px 18px",
                      color: "#7e98b1",
                      fontSize: 14,
                      lineHeight: 1.45,
                    }}
                  >
                    Run summary mode to see each team&apos;s chance at Pick #1, top-two odds, average final slot, and most common landing spot.
                  </div>
                )
              ) : (
                result ? (
                <>
                  <div className="lottery-results-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {[latestPickTwoWinner, latestPickOneWinner].map((winner, index) => {
                      const drawLabel = index === 0 ? "Pick #2 reveal" : "Pick #1 reveal";
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
                            {drawLabel}
                          </div>
                          {winner ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <TeamLogo abbr={winner.currentOwner} size={40} />
                              <div>
                                <div style={{ color: "#f1f9ff", fontSize: 19, fontWeight: 900 }}>
                                  {winner.standings.name}
                                </div>
                                <div style={{ color: "#86c9f4", fontSize: 13 }}>
                                  Wins pick #{winner.wonPick} · {winner.moved > 0 ? `+${winner.moved}` : "no jump"}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div style={{ color: "#65819e", fontSize: 14 }}>Waiting for reveal…</div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ fontSize: 12, color: "#7d95ab", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      Final simulated order
                    </div>
                    {result.finalOrder.map((row, index) => (
                      (() => {
                        const resolvedPick = resolvedDraftOrder.find((pick) => pick.originalTeam === row.originalTeam);
                        const selectionOwner = resolvedPick?.selectionOwner || row.currentOwner;
                        const ownerChanged = selectionOwner !== row.originalTeam;
                        const asset = assetByOriginalTeam[row.originalTeam];
                        const conditionNote = buildPickTooltip(asset, resolvedPick);
                        return (
                          <div
                            key={row.pickId}
                            className={`lottery-board-row ${boardVisible ? "" : "lottery-ghost-row"}`}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "48px minmax(0, 1fr) auto",
                              gap: 12,
                              alignItems: "center",
                              padding: "12px 14px",
                              borderRadius: 16,
                              background: row.finalPick <= 2 ? "linear-gradient(180deg, rgba(16, 62, 98, 0.32) 0%, rgba(10, 18, 27, 0.9) 100%)" : "#0e1620",
                              border: row.finalPick <= 2 ? "1px solid #2f6b98" : "1px solid #182736",
                              transform: boardVisible ? "translateX(0)" : `translateX(${index % 2 === 0 ? -18 : 18}px)`,
                              opacity: boardVisible ? 1 : 0.35,
                              transitionDelay: `${index * 55}ms`,
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
                ) : (
                  <div
                    style={{
                      borderRadius: 18,
                      border: "1px dashed #244158",
                      background: "#0d1620",
                      padding: "22px 18px",
                      color: "#7e98b1",
                      fontSize: 14,
                      lineHeight: 1.45,
                    }}
                  >
                    Run the lottery to reveal Pick #2 first, then Pick #1, then watch the final draft board settle into place.
                  </div>
                )
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
                  Ownership & protections
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
                  const asset = assetByOriginalTeam[row.originalTeam];
                  const conditionNote = buildPickTooltip(asset, row);
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
