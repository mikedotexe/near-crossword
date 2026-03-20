import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import AppShell from "../src/components/layout/AppShell";
import { trackEvent } from "../src/lib/analytics";
import { useAppFlow } from "../src/lib/appFlow";

const CrosswordPage = dynamic(() => import("../src/components/CrosswordPage"), {
  ssr: false,
});

const LoadingCard = ({ message }) => (
  <section className="card">
    <p>{message}</p>
  </section>
);

export default function PlayRoute() {
  const router = useRouter();
  const {
    configWarning,
    data,
    initError,
    initLoading,
    onCrosswordComplete,
    resolveRoute,
  } = useAppFlow();

  const redirectPath = !initLoading && !initError ? resolveRoute("play") : null;
  const holdRedirectForConfigWarning = Boolean(
    configWarning && redirectPath === "/empty"
  );

  useEffect(() => {
    if (redirectPath && !holdRedirectForConfigWarning) {
      router.replace(redirectPath);
      return;
    }

    if (!initLoading && !initError && data) {
      trackEvent("play_view_loaded");
    }
  }, [
    data,
    holdRedirectForConfigWarning,
    initError,
    initLoading,
    redirectPath,
    router,
  ]);

  if (initLoading) {
    return (
      <AppShell
        contextMessage="Solve the puzzle to win."
        contextCtaHref="/create"
        contextCtaLabel="Create a Puzzle"
        warningMessage={configWarning}
      >
        <LoadingCard message="Loading puzzle..." />
      </AppShell>
    );
  }

  if (initError) {
    return (
      <AppShell
        contextMessage="Solve the puzzle to win."
        contextCtaHref="/create"
        contextCtaLabel="Create a Puzzle"
        warningMessage={configWarning}
      >
        <section className="card">
          <p className="error-msg">{initError}</p>
        </section>
      </AppShell>
    );
  }

  if (holdRedirectForConfigWarning) {
    return (
      <AppShell
        contextMessage="Solve the puzzle to win."
        contextCtaHref="/create"
        contextCtaLabel="Create a Puzzle"
        warningMessage={configWarning}
      >
        <section className="card">
          <p>Configure the contract to load active puzzles for this route.</p>
        </section>
      </AppShell>
    );
  }

  if (redirectPath || !data) {
    return (
      <AppShell
        contextMessage="Solve the puzzle to win."
        contextCtaHref="/create"
        contextCtaLabel="Create a Puzzle"
        warningMessage={configWarning}
      >
        <LoadingCard message="Redirecting..." />
      </AppShell>
    );
  }

  return (
    <AppShell
      contextMessage="Solve the puzzle to win."
      contextCtaHref="/create"
      contextCtaLabel="Create a Puzzle"
      warningMessage={configWarning}
    >
      <CrosswordPage data={data} onCrosswordComplete={onCrosswordComplete} />
    </AppShell>
  );
}
