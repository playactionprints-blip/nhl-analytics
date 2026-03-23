/**
 * Server entrypoint for the Fantasy Hub.
 * Depends on the Fantasy Hub client app and breadcrumb system only.
 */
import { BreadcrumbSetter } from "@/Breadcrumbs";
import FantasyHubApp from "@/app/components/fantasy-hub/FantasyHubApp";

export const metadata = {
  title: "Fantasy Hub — NHL Analytics",
  description: "Custom fantasy rankings, roster management, and schedule analysis for fantasy hockey leagues.",
};

export default function FantasyHubPage() {
  return (
    <>
      <BreadcrumbSetter items={[{ href: "/fantasy", label: "Fantasy Hub" }]} />
      <FantasyHubApp />
    </>
  );
}
