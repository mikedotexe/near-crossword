import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import AppShell from "../src/components/layout/AppShell";
import { useAppFlow } from "../src/lib/appFlow";

const SuccessPage = dynamic(() => import("../src/components/SuccessPage"), {
  ssr: false,
});

export default function ClaimedRoute() {
  const router = useRouter();
  const { initError, initLoading, resolveRoute } = useAppFlow();

  const redirectPath =
    !initLoading && !initError ? resolveRoute("claimed") : null;

  useEffect(() => {
    if (redirectPath) {
      router.replace(redirectPath);
    }
  }, [redirectPath, router]);

  if (initLoading || redirectPath) {
    return (
      <AppShell
        contextMessage="Your reward has been claimed."
        contextCtaHref="/create"
        contextCtaLabel="Create a Puzzle"
      >
        <section className="card">
          <p>Loading claim status...</p>
        </section>
      </AppShell>
    );
  }

  if (initError) {
    return (
      <AppShell
        contextMessage="Your reward has been claimed."
        contextCtaHref="/create"
        contextCtaLabel="Create a Puzzle"
      >
        <section className="card">
          <p className="error-msg">{initError}</p>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell
      contextMessage="Your reward has been claimed."
      contextCtaHref="/create"
      contextCtaLabel="Create a Puzzle"
    >
      <SuccessPage />
    </AppShell>
  );
}
