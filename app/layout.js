import "./globals.css";
import TopNav from "@/TopNav";
import { BreadcrumbBar, BreadcrumbProvider } from "@/Breadcrumbs";
import LiveScoresBanner from "@/app/components/LiveScoresBanner";
import { ThemeProvider } from "@/app/components/ThemeProvider";

export const metadata = {
  title: "NHL Analytics",
  description: "WAR · RAPM · On-Ice Shot Rates · Percentile Rankings",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t=localStorage.getItem('nhl-theme')||'dark';document.documentElement.setAttribute('data-theme',t);})();` }} />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <BreadcrumbProvider>
            <TopNav />
            <LiveScoresBanner />
            <BreadcrumbBar />
            {children}
          </BreadcrumbProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
