import "./globals.css";
import TopNav from "@/TopNav";
import { BreadcrumbBar, BreadcrumbProvider } from "@/Breadcrumbs";

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
          <BreadcrumbBar />
          {children}
        </BreadcrumbProvider>
      </body>
    </html>
  );
}
