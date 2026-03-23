"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/players", label: "Players" },
  { href: "/teams", label: "Teams" },
  { href: "/compare", label: "Compare" },
  { href: "/predictions", label: "Predictions" },
  { href: "/playoff-odds", label: "Playoff Odds" },
  { href: "/roster-builder", label: "Roster Builder" },
  { href: "/lottery", label: "NHL Lottery" },
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

export default function TopNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  return (
    <>
      <style>{`
        .top-nav-shell {
          position: sticky;
          top: 0;
          z-index: 100;
          background: rgba(5,9,15,0.92);
          backdrop-filter: blur(8px);
          border-bottom: 1px solid #1e2d40;
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
            margin-left: auto;
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
            background: rgba(2, 6, 10, 0.78);
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
        }
      `}</style>

      <nav className="top-nav-shell">
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
          <div className="top-nav-divider" style={{ width: 1, height: 20, background: "#1e2d40", flexShrink: 0 }} />
          <div className="top-nav-links">
            {NAV_ITEMS.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} style={navLinkStyle(active)}>
                  {item.label}
                </Link>
              );
            })}
          </div>
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

      <div className={`top-nav-mobile-panel ${menuOpen ? "open" : ""}`}>
        <button
          type="button"
          className="top-nav-mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
          style={{ border: "none", cursor: "pointer" }}
        />
        <div className="top-nav-mobile-sheet">
          <div style={{ fontSize: 10, color: "#5e86a8", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>
            Navigation
          </div>
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
            return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  style={{
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  minHeight: 46,
                  padding: "12px 14px",
                  borderRadius: 16,
                  border: `1px solid ${active ? "#2fb4ff" : "#1e3143"}`,
                  background: active ? "rgba(47,180,255,0.12)" : "#0c151f",
                  color: active ? "#d6f0ff" : "#a6bfd6",
                  fontSize: 15,
                  fontWeight: 800,
                }}
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
