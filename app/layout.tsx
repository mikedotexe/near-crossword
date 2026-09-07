import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "./components/SiteFooter";
import { SiteHeader } from "./components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Crossword — Sponsor-funded learning rewards on Base",
    template: "%s · Crossword",
  },
  description:
    "Launch source-grounded learning campaigns and distribute auditable USDC rewards on Base.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "https://crossword.xyz",
  ),
  openGraph: {
    title: "Crossword",
    description: "Sponsor-funded learning rewards on Base.",
    type: "website",
    images: [
      {
        url: "/og-base.png",
        width: 1200,
        height: 800,
        alt: "Crossword sponsor-funded learning rewards on Base",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Crossword",
    description: "Sponsor-funded learning rewards on Base.",
    images: ["/og-base.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main-content">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
