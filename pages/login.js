import { useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/router";
import TopNav from "../src/components/layout/TopNav";

export default function LoginPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  if (session) {
    router.replace("/");
    return null;
  }

  const handleEmail = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    await signIn("email", { email: email.trim(), redirect: false });
    setSent(true);
    setLoading(false);
  };

  return (
    <div className="app-shell">
      <TopNav />
      <main className="app-main app-container">
        <div className="login-card card">
          <div className="section-header">
            <p className="eyebrow">Account</p>
            <h2>Sign in</h2>
            <p>Sign in to submit AI Studio jobs in the background and get emailed when they&apos;re ready.</p>
          </div>

          <div className="field-group">
            <button
              className="button button-secondary"
              onClick={() => signIn("google")}
              style={{ width: "100%" }}
            >
              Continue with Google
            </button>
          </div>

          <div style={{ textAlign: "center", color: "var(--muted)", margin: "0.75rem 0", fontSize: "0.85rem" }}>
            or
          </div>

          {sent ? (
            <p className="info-msg">
              Check your email for a sign-in link. It expires in 1 hour.
            </p>
          ) : (
            <form onSubmit={handleEmail}>
              <div className="field-group">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="field-group" style={{ marginTop: "0.5rem" }}>
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={loading || !email.trim()}
                  style={{ width: "100%" }}
                >
                  {loading ? "Sending..." : "Send Magic Link"}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
