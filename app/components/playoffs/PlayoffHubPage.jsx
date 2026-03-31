"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BreadcrumbSetter } from "@/Breadcrumbs";
import GameImplicationsSection from "@/app/components/playoffs/GameImplicationsSection";
import DailyMoversSection from "@/app/components/playoffs/DailyMoversSection";
import TeamProjectionGrid from "@/app/components/playoffs/TeamProjectionGrid";
import BestWorstCaseSection from "@/app/components/playoffs/BestWorstCaseSection";

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

export default function PlayoffHubPage() {
  const [overview, setOverview] = useState(null);
  const [gameImpacts, setGameImpacts] = useState(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [conferenceFilter, setConferenceFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [sortKey, setSortKey] = useState("playoffProbability");
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingImpacts, setLoadingImpacts] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchJson("/api/playoffs/overview")
      .then((payload) => {
        if (cancelled) return;
        setOverview(payload);
        const initialDate = payload.availableDates?.[0] || "";
        if (initialDate) setLoadingImpacts(true);
        setSelectedDate((current) => current || initialDate);
        setTeamFilter((current) => current || payload.teams?.[0]?.team || "");
        setError("");
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load playoff projections right now.");
      })
      .finally(() => {
        if (!cancelled) setLoadingOverview(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    fetchJson(`/api/playoffs/game-impacts?date=${selectedDate}`)
      .then((payload) => {
        if (cancelled) return;
        setGameImpacts(payload);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load game implications for the selected date.");
      })
      .finally(() => {
        if (!cancelled) setLoadingImpacts(false);
      });
    return () => { cancelled = true; };
  }, [selectedDate]);

  function handleDateChange(nextDate) {
    setLoadingImpacts(true);
    setSelectedDate(nextDate);
  }

  const filteredTeams = useMemo(() => {
    const teams = overview?.teams || [];
    const byConference = conferenceFilter
      ? teams.filter((team) => team.conference === conferenceFilter)
      : teams;

    if (sortKey === "projectedPoints") {
      return [...byConference].sort((a, b) => b.projectedPoints - a.projectedPoints);
    }
    if (sortKey === "delta") {
      return [...byConference].sort((a, b) => b.playoffDelta - a.playoffDelta);
    }
    if (sortKey === "cup") {
      return [...byConference].sort((a, b) => b.cupProbability - a.cupProbability);
    }
    return [...byConference].sort((a, b) => b.playoffProbability - a.playoffProbability);
  }, [conferenceFilter, overview?.teams, sortKey]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at top, rgba(30,71,108,0.25), transparent 42%), var(--bg-primary)",
        padding: "34px 20px 68px",
      }}
    >
      <BreadcrumbSetter items={[{ href: "/playoffs", label: "Playoffs" }]} />
      <style>{`
        .playoff-hub-grid {
          display: grid;
          gap: 22px;
        }
        @media (min-width: 1024px) {
          .playoff-overview-grid {
            display: grid;
            grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
            gap: 22px;
            align-items: start;
          }
        }
      `}</style>

      <div style={{ maxWidth: 1380, margin: "0 auto", display: "grid", gap: 24 }}>
        <header style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: "var(--text-secondary)", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                NHL Analytics
              </div>
              <h1 style={{ margin: "6px 0 0", color: "var(--text-primary)", fontSize: 48, lineHeight: 0.95, fontWeight: 900 }}>
                Playoff Projection Hub
              </h1>
              <p style={{ margin: "10px 0 0", color: "var(--text-secondary)", fontSize: 15, maxWidth: 760, lineHeight: 1.55 }}>
                Track tonight’s biggest playoff swings, league-wide movers, and full season outcome distributions from one game-by-game simulation engine.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/predictions" style={{ textDecoration: "none", borderRadius: 999, padding: "10px 16px", border: "1px solid rgba(47,180,255,0.25)", color: "#9fd8ff", background: "rgba(47,180,255,0.08)", fontFamily: "'DM Mono',monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                View predictions
              </Link>
              <Link href="/playoff-odds" style={{ textDecoration: "none", borderRadius: 999, padding: "10px 16px", border: "1px solid var(--border-strong)", color: "var(--text-primary)", background: "var(--bg-card)", fontFamily: "'DM Mono',monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Legacy odds board
              </Link>
            </div>
          </div>

          <div style={{ borderRadius: 20, border: "1px solid var(--border-strong)", background: "var(--bg-card)", padding: "16px 18px", display: "grid", gap: 6 }}>
            <div style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Model notes
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.55 }}>
              Regular-season outcomes are sampled game by game using the site’s current team-strength and win-probability stack. Daily movers compare against a reconstructed prior snapshot, and cup odds use a lighter best-of-seven team-strength approximation.
            </div>
          </div>
        </header>

        {error && (
          <div style={{ borderRadius: 16, border: "1px solid rgba(255,141,155,0.35)", background: "rgba(255,141,155,0.08)", padding: "14px 16px", color: "#ffb6bf" }}>
            {error}
          </div>
        )}

        {loadingOverview && (
          <div style={{ borderRadius: 24, border: "1px solid var(--border-strong)", background: "var(--bg-card)", padding: "18px 20px", color: "var(--text-secondary)" }}>
            Building the latest playoff race snapshot.
          </div>
        )}

        {!loadingOverview && overview && (
          <div className="playoff-hub-grid">
            <GameImplicationsSection
              loading={loadingImpacts}
              dateOptions={overview.availableDates || []}
              selectedDate={selectedDate}
              onDateChange={handleDateChange}
              data={gameImpacts}
            />

            <div className="playoff-overview-grid">
              <DailyMoversSection
                overview={overview}
                conferenceFilter={conferenceFilter}
                sortKey={sortKey}
                onConferenceChange={setConferenceFilter}
                onSortChange={setSortKey}
              />

              <BestWorstCaseSection
                teamCode={teamFilter || filteredTeams[0]?.team || ""}
                onTeamChange={setTeamFilter}
                teams={overview.teams || []}
                gameImpacts={gameImpacts?.games || []}
              />
            </div>

            <TeamProjectionGrid
              teams={filteredTeams}
              teamFilter={teamFilter}
              onTeamFilterChange={setTeamFilter}
            />
          </div>
        )}
      </div>
    </div>
  );
}
