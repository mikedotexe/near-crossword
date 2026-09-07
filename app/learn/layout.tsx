import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ParticipantAccountProvider } from "./ParticipantAccount";
import "./learning.css";

export const metadata: Metadata = {
  title: "Learn with Crossword",
  description:
    "Short lessons. Small crosswords. Sponsor-funded USDC rewards on Base.",
};
export default function LearningLayout({ children }: { children: ReactNode }) {
  return (
    <ParticipantAccountProvider
      projectId={process.env.NEXT_PUBLIC_CDP_PROJECT_ID || null}
    >
      <div className="learning">
        <div className="learn-shell">{children}</div>
      </div>
    </ParticipantAccountProvider>
  );
}
