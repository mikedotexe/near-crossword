import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./learning.css";

export const metadata: Metadata = {
  title: "Learn with Crossword",
  description:
    "Short lessons. Small crosswords. Sponsor-funded USDC rewards on Base.",
};
export default function LearningLayout({ children }: { children: ReactNode }) {
  return (
    <div className="learning">
      <div className="learn-shell">{children}</div>
    </div>
  );
}
