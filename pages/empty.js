import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import AppShell from "../src/components/layout/AppShell";
import { useAppFlow } from "../src/lib/appFlow";

const NoCrosswordsPage = dynamic(
  () => import("../src/components/NoCrosswordsPage"),
  {
    ssr: false,
  }
);

export default function EmptyRoute() {
  const router = useRouter();
  const { initError, initLoading, resolveRoute } = useAppFlow();

  const redirectPath = !initLoading && !initError ? resolveRoute("empty") : null;

  useEffect(() => {
    if (redirectPath) {
      router.replace(redirectPath);
    }
  }, [redirectPath, router]);

  if (initLoading || redirectPath) {
    return (
      <AppShell
        contextMessage="No live puzzle currently. Publish one in creator mode."
        contextCtaHref="/create"
        contextCtaLabel="Create Puzzle"
      >
        <section className="card">
          <p>Checking puzzle availability...</p>
        </section>
      </AppShell>
    );
  }

  if (initError) {
    return (
      <AppShell
        contextMessage="No live puzzle currently. Publish one in creator mode."
        contextCtaHref="/create"
        contextCtaLabel="Create Puzzle"
      >
        <section className="card">
          <p className="error-msg">{initError}</p>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell
      contextMessage="No live puzzle currently. Publish one in creator mode."
      contextCtaHref="/create"
      contextCtaLabel="Create Puzzle"
    >
      <NoCrosswordsPage />
    </AppShell>
  );
}
