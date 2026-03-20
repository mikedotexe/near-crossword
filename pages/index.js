import { useEffect } from "react";
import { useRouter } from "next/router";
import AppShell from "../src/components/layout/AppShell";
import LandingPage from "../src/components/pages/LandingPage";
import { trackEvent } from "../src/lib/analytics";
import { useAppFlow } from "../src/lib/appFlow";

const HASH_REDIRECTS = {
  "/": "/",
  "/play": "/play",
  "/create": "/create",
  "/claim": "/claim",
  "/claimed": "/claimed",
  "/empty": "/empty",
  "/ai-studio": "/ai-studio",
};

const LoadingCard = () => (
  <section className="card">
    <p>Loading crossword...</p>
  </section>
);

export default function HomePage() {
  const router = useRouter();
  const { hasActivePuzzle, initError, initLoading } = useAppFlow();

  useEffect(() => {
    const rawHash = window.location.hash || "";
    if (!rawHash.startsWith("#/")) {
      return;
    }

    const withoutPound = rawHash.replace(/^#/, "");
    const hashPath = withoutPound.split("?")[0];
    const redirectPath = HASH_REDIRECTS[hashPath];

    if (!redirectPath || redirectPath === "/") {
      return;
    }

    trackEvent("hash_bridge_redirect", {
      from_hash: rawHash,
      to_path: redirectPath,
    });

    router.replace(redirectPath);
  }, [router]);

  if (initLoading) {
    return (
      <AppShell showCampaign>
        <LoadingCard />
      </AppShell>
    );
  }

  if (initError) {
    return (
      <AppShell showCampaign>
        <section className="card">
          <p className="error-msg">{initError}</p>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell showCampaign>
      <LandingPage hasActivePuzzle={hasActivePuzzle} />
    </AppShell>
  );
}
