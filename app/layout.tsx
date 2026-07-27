import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "./components/SiteFooter";
import { SiteHeader } from "./components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Crossword Campaigns — Fund with anything. Win anywhere.",
    template: "%s · Crossword Campaigns",
  },
  description:
    "Sponsor-funded crossword campaigns with prizes locked on NEAR and routed through NEAR Intents.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "https://crossword.xyz",
  ),
  openGraph: {
    title: "Crossword Campaigns",
    description: "Fund with anything. Win anywhere.",
    type: "website",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 800,
        alt: "Fund with anything. Win anywhere.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Crossword Campaigns",
    description: "Fund with anything. Win anywhere.",
    images: ["/og.jpg"],
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
