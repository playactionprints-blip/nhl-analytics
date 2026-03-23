"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TEAM_FULL = {
  ANA: "Anaheim Ducks", BOS: "Boston Bruins", BUF: "Buffalo Sabres",
  CAR: "Carolina Hurricanes", CBJ: "Columbus Blue Jackets", CGY: "Calgary Flames",
  CHI: "Chicago Blackhawks", COL: "Colorado Avalanche", DAL: "Dallas Stars",
  DET: "Detroit Red Wings", EDM: "Edmonton Oilers", FLA: "Florida Panthers",
  LAK: "Los Angeles Kings", MIN: "Minnesota Wild", MTL: "Montréal Canadiens",
  NSH: "Nashville Predators", NJD: "New Jersey Devils", NYI: "New York Islanders",
  NYR: "New York Rangers", OTT: "Ottawa Senators", PHI: "Philadelphia Flyers",
  PIT: "Pittsburgh Penguins", SEA: "Seattle Kraken", SJS: "San Jose Sharks",
  STL: "St. Louis Blues", TBL: "Tampa Bay Lightning", TOR: "Toronto Maple Leafs",
  UTA: "Utah Hockey Club", VAN: "Vancouver Canucks", VGK: "Vegas Golden Knights",
  WPG: "Winnipeg Jets", WSH: "Washington Capitals",
};

const BreadcrumbContext = createContext({
  override: null,
  setOverride: () => {},
});

function fallbackBreadcrumbs(pathname) {
  if (!pathname || pathname === "/") return [];

  if (pathname === "/teams") {
    return [{ href: "/teams", label: "Teams" }];
  }

  if (pathname.startsWith("/team/")) {
    const teamCode = pathname.split("/")[2]?.toUpperCase();
    return [
      { href: "/teams", label: "Teams" },
      { href: pathname, label: TEAM_FULL[teamCode] || teamCode || "Team" },
    ];
  }

  if (pathname === "/predictions") {
    return [{ href: "/predictions", label: "Predictions" }];
  }

  if (pathname.startsWith("/predictions/")) {
    return [
      { href: "/predictions", label: "Predictions" },
      { href: pathname, label: "Game Detail" },
    ];
  }

  if (pathname === "/lottery") {
    return [{ href: "/lottery", label: "NHL Lottery" }];
  }

  return [];
}

export function BreadcrumbProvider({ children }) {
  const pathname = usePathname();
  const [override, setOverride] = useState(null);

  const value = useMemo(() => ({ override, setOverride, pathname }), [override, pathname]);

  return (
    <BreadcrumbContext.Provider value={value}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function BreadcrumbSetter({ items }) {
  const { setOverride, pathname } = useContext(BreadcrumbContext);

  useEffect(() => {
    setOverride(items ? { pathname, items } : null);
    return () => setOverride(null);
  }, [items, pathname, setOverride]);

  return null;
}

export function BreadcrumbBar() {
  const pathname = usePathname();
  const { override } = useContext(BreadcrumbContext);
  const resolvedItems =
    override?.pathname === pathname
      ? override.items
      : fallbackBreadcrumbs(pathname);

  if (!pathname || pathname === "/" || !resolvedItems.length) return null;

  return (
    <div
      className="breadcrumb-bar"
      style={{
        position: "sticky",
        top: "var(--top-nav-height)",
        zIndex: 95,
        background: "rgba(5,9,15,0.88)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid #142232",
        padding: "10px 24px",
      }}
    >
      <div
        className="breadcrumb-mobile-wrap"
        style={{
          maxWidth: 1320,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          fontSize: 12,
          color: "#6f879f",
          fontFamily: "'DM Mono',monospace",
          letterSpacing: "0.02em",
        }}
      >
        {resolvedItems.map((item, index) => (
          <div key={`${item.href}-${item.label}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {index > 0 && <span style={{ color: "#3e5872" }}>›</span>}
            <Link
              href={item.href}
              style={{
                color: index === resolvedItems.length - 1 ? "#a9c1d7" : "#7d96ad",
                textDecoration: "none",
              }}
            >
              {item.label}
            </Link>
          </div>
        ))}
      </div>
      <style>{`
        @media (max-width: 860px) {
          .breadcrumb-bar {
            position: static !important;
            padding: 8px 16px !important;
          }
          .breadcrumb-mobile-wrap {
            overflow-x: auto;
            scrollbar-width: none;
            flex-wrap: nowrap !important;
            white-space: nowrap;
          }
        }
      `}</style>
    </div>
  );
}
