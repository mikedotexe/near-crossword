import Link from "next/link";
import TopNav from "../src/components/layout/TopNav";

export default function CheckEmailPage() {
  return (
    <div className="app-shell">
      <TopNav />
      <main className="app-main app-container">
        <div className="login-card card">
          <div className="section-header">
            <p className="eyebrow">Almost there</p>
            <h2>Check your email</h2>
            <p>
              We sent you a sign-in link. It expires in one hour.
            </p>
          </div>
          <p style={{ marginTop: "1rem" }}>
            Didn&apos;t get it?{" "}
            <Link href="/login">Try again</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
