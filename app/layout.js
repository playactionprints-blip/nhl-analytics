import "./globals.css";
import TopNav from "@/TopNav";
import { BreadcrumbBar, BreadcrumbProvider } from "@/Breadcrumbs";
import LiveScoresBanner from "@/app/components/LiveScoresBanner";

export const metadata = {
  title: "NHL Analytics",
  description: "WAR · RAPM · On-Ice Shot Rates · Percentile Rankings",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <BreadcrumbProvider>
          <TopNav />
          <LiveScoresBanner />
          <BreadcrumbBar />
          {children}
        </BreadcrumbProvider>
      </body>
    </html>
  );
}
