import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import AppShell from "../src/components/layout/AppShell";
import { useAppFlow } from "../src/lib/appFlow";

const WonPage = dynamic(() => import("../src/components/WonPage"), {
  ssr: false,
});

const LoadingCard = ({ message }) => (
  <section className="card">
    <p>{message}</p>
  </section>
);

export default function ClaimRoute() {
  const router = useRouter();
  const {
    claimError,
    claimPrize,
    claimStatusClasses,
    configWarning,
    initError,
    initLoading,
    nearConfig,
    needsNewAccount,
    playerKeyPair,
    resolveRoute,
    setNeedsNewAccount,
  } = useAppFlow();

  const redirectPath = !initLoading && !initError ? resolveRoute("claim") : null;
  const holdRedirectForConfigWarning = Boolean(configWarning && redirectPath);

  useEffect(() => {
    if (redirectPath && !holdRedirectForConfigWarning) {
      router.replace(redirectPath);
    }
  }, [holdRedirectForConfigWarning, redirectPath, router]);

  if (initLoading) {
    return (
      <AppShell
        contextMessage="Claim your reward after solving the puzzle."
        contextCtaHref="/play"
        contextCtaLabel="Back to Play"
        warningMessage={configWarning}
      >
        <LoadingCard message="Loading claim flow..." />
      </AppShell>
    );
  }

  if (initError) {
    return (
      <AppShell
        contextMessage="Claim your reward after solving the puzzle."
        contextCtaHref="/play"
        contextCtaLabel="Back to Play"
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
        contextMessage="Claim your reward after solving the puzzle."
        contextCtaHref="/play"
        contextCtaLabel="Back to Play"
        warningMessage={configWarning}
      >
        <section className="card">
          <p>Configure the contract before using the claim flow.</p>
        </section>
      </AppShell>
    );
  }

  if (redirectPath || !nearConfig || !playerKeyPair) {
    return (
      <AppShell
        contextMessage="Claim your reward after solving the puzzle."
        contextCtaHref="/play"
        contextCtaLabel="Back to Play"
        warningMessage={configWarning}
      >
        <LoadingCard message="Redirecting..." />
      </AppShell>
    );
  }

  return (
    <AppShell
      contextMessage="Claim your reward after solving the puzzle."
      contextCtaHref="/play"
      contextCtaLabel="Back to Play"
      warningMessage={configWarning}
    >
      <WonPage
        claimStatusClasses={claimStatusClasses}
        claimError={claimError}
        needsNewAccount={needsNewAccount}
        setNeedsNewAccount={setNeedsNewAccount}
        claimPrize={claimPrize}
        playerKeyPair={playerKeyPair}
        nearConfig={nearConfig}
      />
    </AppShell>
  );
}
