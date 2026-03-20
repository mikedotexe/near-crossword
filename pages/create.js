import dynamic from "next/dynamic";
import AppShell from "../src/components/layout/AppShell";
import { useAppFlow } from "../src/lib/appFlow";

const CreatePage = dynamic(() => import("../src/components/pages/CreatePage"), {
  ssr: false,
  loading: () => (
    <section className="card">
      <p>Loading creator flow...</p>
    </section>
  ),
});

export default function CreateRoute() {
  const { configWarning } = useAppFlow();

  return (
    <AppShell
      contextMessage="Create a new puzzle."
      contextCtaHref="/play"
      contextCtaLabel="View Live Puzzle"
      warningMessage={configWarning}
    >
      <CreatePage />
    </AppShell>
  );
}
