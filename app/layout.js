import "./globals.css";
import TopNav from "@/TopNav";

export const metadata = {
  title: "NHL Analytics",
  description: "WAR · RAPM · On-Ice Shot Rates · Percentile Rankings",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <TopNav />
        {children}
      </body>
    </html>
  );
}
