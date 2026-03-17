import { Suspense } from "react";
import CompareClient from "./CompareClient";

export const metadata = { title: "Player Compare · NHL Analytics" };

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <CompareClient />
    </Suspense>
  );
}
