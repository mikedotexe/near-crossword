import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Check your email",
};

export default function CheckEmailPage() {
  return (
    <section className="state-page">
      <div className="shell state-card state-card--email">
        <span className="mail-mark" aria-hidden="true">
          ↗
        </span>
        <p className="eyebrow">Secure sign in</p>
        <h1>Check your inbox.</h1>
        <p>
          If that address is allowed to sign in, a one-time link is on its way.
          The link expires automatically and does not approve any payment.
        </p>
        <Link className="text-link" href="/login">
          Use a different address →
        </Link>
      </div>
    </section>
  );
}
