/**
 * Server entrypoint for the Armchair GM roster builder route.
 * Depends on the client roster-builder app and reads the optional
 * base64 roster query param for initial state restoration.
 */
import RosterBuilderApp from "@/app/components/roster-builder/RosterBuilderApp";

export const metadata = {
  title: "Roster Builder — NHL Analytics",
  description: "Build and share custom NHL line combinations with cap tracking and roster analytics.",
};

export default async function RosterBuilderPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  return <RosterBuilderApp initialRosterParam={resolvedSearchParams?.roster || ""} />;
}
