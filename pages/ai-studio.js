import dynamic from "next/dynamic";
import AppShell from "../src/components/layout/AppShell";

const AIStudioPage = dynamic(() => import("../src/components/pages/AIStudioPage"), {
  ssr: false,
  loading: () => (
    <section className="card">
      <p>Loading AI Studio...</p>
    </section>
  ),
});

export default function AIStudioRoute() {
  return (
    <AppShell
      contextMessage="Generate puzzle clues with AI."
      contextCtaHref="/create"
      contextCtaLabel="Back to Create"
    >
      <AIStudioPage />
    </AppShell>
  );
}
