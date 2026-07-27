import type { Metadata } from "next";
import { LoginPanel } from "../../components/LoginPanel";

export const metadata: Metadata = {
  title: "Creator sign in",
};

export default function LoginPage() {
  return (
    <section className="login-page">
      <div className="shell">
        <LoginPanel />
      </div>
    </section>
  );
}
