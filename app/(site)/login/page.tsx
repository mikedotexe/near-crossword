import type { Metadata } from "next";
import { LoginPanel } from "../../components/LoginPanel";

export const metadata: Metadata = {
  title: "Creator sign in",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl: requested } = await searchParams;
  const callbackUrl = typeof requested === "string" && /^\/learn(?:\/[a-zA-Z0-9-]+)*$/.test(requested) ? requested : "/dashboard";
  return (
    <section className="login-page">
      <div className="shell">
        <LoginPanel callbackUrl={callbackUrl} learning={callbackUrl.startsWith("/learn")} />
      </div>
    </section>
  );
}
