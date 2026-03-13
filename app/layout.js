import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "NHL Analytics",
  description: "WAR · RAPM · On-Ice Shot Rates · Percentile Rankings",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <nav style={{
          position: 'sticky', top: 0, zIndex: 100,
          background: 'rgba(5,9,15,0.92)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid #1e2d40',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 28,
          height: 44,
        }}>
          <Link href="/" style={{ fontSize: 15, fontWeight: 900, color: '#e8f4ff', fontFamily: "'Barlow Condensed',sans-serif", textDecoration: 'none', letterSpacing: '-0.5px' }}>
            NHL Analytics
          </Link>
          <div style={{ width: 1, height: 20, background: '#1e2d40' }} />
          <Link href="/" style={{ fontSize: 11, fontWeight: 700, color: '#4a6a88', fontFamily: "'DM Mono',monospace", textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Players
          </Link>
          <Link href="/teams" style={{ fontSize: 11, fontWeight: 700, color: '#4a6a88', fontFamily: "'DM Mono',monospace", textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Teams
          </Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
