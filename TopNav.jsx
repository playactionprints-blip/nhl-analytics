"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Players" },
  { href: "/teams", label: "Teams" },
  { href: "/compare", label: "Compare" },
  { href: "/predictions", label: "Predictions" },
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

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "rgba(5,9,15,0.92)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid #1e2d40",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        gap: 28,
        height: 44,
      }}
    >
      <Link
        href="/"
        style={{
          fontSize: 15,
          fontWeight: 900,
          color: "#e8f4ff",
          fontFamily: "'Barlow Condensed',sans-serif",
          textDecoration: "none",
          letterSpacing: "-0.5px",
        }}
      >
        NHL Analytics
      </Link>
      <div style={{ width: 1, height: 20, background: "#1e2d40" }} />
      {NAV_ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} style={navLinkStyle(active)}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
