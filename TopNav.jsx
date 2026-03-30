"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/app/components/ThemeProvider";

const PLAYER_GROUP = [
  { href: "/players",  label: "Players" },
  { href: "/history",  label: "Historical Players" },
  { href: "/compare",  label: "Compare" },
];

const OTHER_NAV_ITEMS = [
  { href: "/teams",          label: "Teams" },
  { href: "/predictions",    label: "Predictions" },
  { href: "/fantasy",        label: "Fantasy Hub" },
  { href: "/playoff-odds",   label: "Playoff Odds" },
  { href: "/roster-builder", label: "Roster Builder" },
  { href: "/lottery",        label: "NHL Lottery" },
];

function navLinkStyle(active) {
  return {
    fontSize: 11,
    fontWeight: 700,
    color: active ? "#9fd8ff" : "#4a6a88",
    fontFamily: "'DM Mono',monospace",
    textDecoration: "none",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    padding: "4px 0",
    borderBottom: active ? "1px solid #2fb4ff" : "1px solid transparent",
    transition: "color 0.16s ease, border-color 0.16s ease",
  };
}

function mobileItemStyle(active, indent = false) {
  return {
    textDecoration: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 46,
    padding: indent ? "12px 14px 12px 22px" : "12px 14px",
    borderRadius: 16,
    border: `1px solid ${active ? "#2fb4ff" : "#1e3143"}`,
    background: active ? "rgba(47,180,255,0.12)" : "#0c151f",
    color: active ? "#d6f0ff" : "#a6bfd6",
    fontSize: 15,
    fontWeight: 800,
  };
}

export default function TopNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const dropdownRef = useRef(null);
  const hoverTimeout = useRef(null);

  const isPlayersActive = PLAYER_GROUP.some((item) => pathname?.startsWith(item.href));

  // Close dropdown on click outside
  useEffect(() => {
    if (!playersOpen) return undefined;
    function onPointerDown(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setPlayersOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [playersOpen]);

  // Close dropdown on route change
  useEffect(() => {
    setPlayersOpen(false);
  }, [pathname]);

  // Clean up hover timeout on unmount
  useEffect(() => () => clearTimeout(hoverTimeout.current), []);

  // Body scroll lock when mobile menu open
  useEffect(() => {
    if (!menuOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [menuOpen]);

  function onDropdownEnter() {
    clearTimeout(hoverTimeout.current);
    setPlayersOpen(true);
  }
  function onDropdownLeave() {
    hoverTimeout.current = setTimeout(() => setPlayersOpen(false), 130);
  }

  return (
    <>
      <style>{`
        .top-nav-shell {
          position: sticky;
          top: 0;
          z-index: 100;
          background: var(--nav-bg);
          backdrop-filter: blur(8px);
          border-bottom: 1px solid var(--nav-border);
        }
        .top-nav-inner {
          max-width: 1440px;
          margin: 0 auto;
          padding: 0 24px;
          display: flex;
          align-items: center;
          gap: 28px;
          height: var(--top-nav-height);
        }
        .top-nav-links {
          display: flex;
          align-items: center;
          gap: 28px;
          min-width: 0;
          flex-wrap: wrap;
        }
        .top-nav-menu-btn {
          display: none;
        }
        .top-nav-mobile-panel {
          display: none;
        }

        /* ── Players dropdown ─────────────────────────────────── */
        .pd-wrap {
          position: relative;
        }
        .pd-trigger {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: none;
          border-top: none;
          border-left: none;
          border-right: none;
          border-bottom: 1px solid transparent;
          cursor: pointer;
          padding: 4px 0;
          font-size: 11px;
          font-weight: 700;
          font-family: 'DM Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #4a6a88;
          transition: color 0.16s ease, border-color 0.16s ease;
        }
        .pd-trigger.active {
          color: #9fd8ff;
          border-bottom-color: #2fb4ff;
        }
        .pd-trigger:hover {
          color: #9fd8ff;
        }
        .pd-chevron {
          display: inline-block;
          font-size: 7px;
          margin-top: 1px;
          transition: transform 0.15s ease;
          line-height: 1;
        }
        .pd-trigger.open .pd-chevron {
          transform: rotate(180deg);
        }
        .pd-panel {
          position: absolute;
          top: calc(100% + 10px);
          left: 50%;
          transform: translateX(-50%) translateY(-5px);
          min-width: 192px;
          background: var(--nav-bg);
          border: 1px solid rgba(47,180,255,0.22);
          border-radius: 10px;
          padding: 5px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3);
          backdrop-filter: blur(14px);
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.14s ease, transform 0.14s ease, visibility 0s linear 0.14s;
          z-index: 200;
        }
        .pd-panel.open {
          opacity: 1;
          visibility: visible;
          transform: translateX(-50%) translateY(0);
          transition: opacity 0.14s ease, transform 0.14s ease;
        }
        .pd-item {
          display: flex;
          align-items: center;
          padding: 9px 13px;
          border-radius: 7px;
          text-decoration: none;
          font-size: 11px;
          font-weight: 700;
          font-family: 'DM Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          white-space: nowrap;
          transition: color 0.12s ease, background-color 0.12s ease;
        }
        .pd-item:hover {
          background: rgba(47,180,255,0.1) !important;
          color: #9fd8ff !important;
        }

        /* Light mode overrides */
        .light .pd-trigger { color: #4a7090; }
        .light .pd-trigger.active { color: #1a7fd4; border-bottom-color: #1a7fd4; }
        .light .pd-trigger:hover { color: #1a7fd4; }
        .light .pd-panel { border-color: rgba(26,127,212,0.22); }
        .light .pd-item:hover {
          background: rgba(26,127,212,0.1) !important;
          color: #1a7fd4 !important;
        }

        /* ── Mobile ─────────────────────────────────────────── */
        @media (max-width: 860px) {
          .top-nav-inner {
            padding: 0 16px;
            gap: 14px;
          }
          .top-nav-divider,
          .top-nav-links {
            display: none !important;
          }
          .top-nav-menu-btn {
            display: inline-flex;
            margin-left: 0;
            align-items: center;
            justify-content: center;
            min-width: 42px;
            height: 42px;
            border-radius: 12px;
            border: 1px solid #27415a;
            background: #0d1823;
            color: #d7ecfb;
            font-size: 18px;
            font-weight: 900;
            cursor: pointer;
          }
          .top-nav-mobile-panel {
            display: block;
            position: fixed;
            inset: var(--top-nav-height) 0 0 0;
            z-index: 99;
            pointer-events: none;
          }
          .top-nav-mobile-backdrop {
            position: absolute;
            inset: 0;
            background: rgba(2,6,10,0.78);
            opacity: 0;
            transition: opacity 0.18s ease;
          }
          .top-nav-mobile-sheet {
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            width: min(86vw, 360px);
            padding: 18px 16px 28px;
            background: linear-gradient(180deg, rgba(11,18,28,0.98) 0%, rgba(7,11,18,0.99) 100%);
            border-left: 1px solid #203345;
            transform: translateX(100%);
            transition: transform 0.22s ease;
            display: grid;
            align-content: start;
            gap: 10px;
            overflow-y: auto;
          }
          .top-nav-mobile-panel.open {
            pointer-events: auto;
          }
          .top-nav-mobile-panel.open .top-nav-mobile-backdrop {
            opacity: 1;
          }
          .top-nav-mobile-panel.open .top-nav-mobile-sheet {
            transform: translateX(0);
          }
          .mobile-section-label {
            font-size: 10px;
            color: #5e86a8;
            font-family: 'DM Mono', monospace;
            text-transform: uppercase;
            letter-spacing: 0.12em;
          }
        }
      `}</style>

      <nav className="top-nav-shell" aria-label="Main navigation">
        <div className="top-nav-inner">
          <Link
            href="/"
            style={{
              fontSize: 15,
              fontWeight: 900,
              color: "#e8f4ff",
              fontFamily: "'Barlow Condensed',sans-serif",
              textDecoration: "none",
              letterSpacing: "-0.5px",
              flexShrink: 0,
            }}
          >
            NHL Analytics
          </Link>
          <div className="top-nav-divider" style={{ width: 1, height: 20, background: "var(--border-strong)", flexShrink: 0 }} />

          <div className="top-nav-links">
            {/* Home */}
            <Link href="/" style={navLinkStyle(pathname === "/")}>Home</Link>

            {/* Players dropdown */}
            <div
              ref={dropdownRef}
              className="pd-wrap"
              onMouseEnter={onDropdownEnter}
              onMouseLeave={onDropdownLeave}
            >
              <button
                type="button"
                className={[
                  "pd-trigger",
                  isPlayersActive ? "active" : "",
                  playersOpen    ? "open"   : "",
                ].filter(Boolean).join(" ")}
                aria-haspopup="true"
                aria-expanded={playersOpen}
                onClick={() => setPlayersOpen((o) => !o)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setPlayersOpen(false);
                  if (e.key === "ArrowDown") { e.preventDefault(); setPlayersOpen(true); }
                }}
              >
                Players
                <span className="pd-chevron" aria-hidden="true">▾</span>
              </button>

              <div
                className={`pd-panel${playersOpen ? " open" : ""}`}
                aria-label="Player pages"
              >
                {PLAYER_GROUP.map((item) => {
                  const active = pathname?.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="pd-item"
                      style={{
                        color:      active ? "#9fd8ff" : "#7a9bbf",
                        background: active ? "rgba(47,180,255,0.1)" : "transparent",
                      }}
                      onClick={() => setPlayersOpen(false)}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Remaining nav items */}
            {OTHER_NAV_ITEMS.map((item) => {
              const active = pathname?.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} style={navLinkStyle(active)}>
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              padding: "5px 9px",
              cursor: "pointer",
              color: "var(--text-secondary)",
              fontSize: 14,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {theme === "dark" ? "☀" : "☽"}
          </button>

          {/* Mobile hamburger */}
          <button
            type="button"
            className="top-nav-menu-btn"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            {menuOpen ? "×" : "☰"}
          </button>
        </div>
      </nav>

      {/* Mobile panel */}
      <div className={`top-nav-mobile-panel${menuOpen ? " open" : ""}`} aria-hidden={!menuOpen}>
        <button
          type="button"
          className="top-nav-mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
          style={{ border: "none", cursor: "pointer" }}
        />
        <div className="top-nav-mobile-sheet">
          <div className="mobile-section-label" style={{ marginBottom: 4 }}>Navigation</div>

          {/* Home */}
          {(() => {
            const active = pathname === "/";
            return (
              <Link href="/" onClick={() => setMenuOpen(false)} style={mobileItemStyle(active)}>
                <span>Home</span>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: active ? "#88d3ff" : "#5d7c99" }}>›</span>
              </Link>
            );
          })()}

          {/* Players group */}
          <div className="mobile-section-label" style={{ marginTop: 4, paddingLeft: 4 }}>Players</div>
          {PLAYER_GROUP.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                style={mobileItemStyle(active, true)}
              >
                <span>{item.label}</span>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: active ? "#88d3ff" : "#5d7c99" }}>›</span>
              </Link>
            );
          })}

          {/* Other items */}
          {OTHER_NAV_ITEMS.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                style={mobileItemStyle(active)}
              >
                <span>{item.label}</span>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: active ? "#88d3ff" : "#5d7c99" }}>›</span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
