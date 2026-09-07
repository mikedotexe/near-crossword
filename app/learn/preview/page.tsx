import { notFound } from "next/navigation";
import { generateLayout, layoutHash } from "../../../src/server/base/layout";
import { learningDraftFixture } from "../../../src/server/v2/learning-draft.fixture";
import { LessonPlayer } from "../LessonPlayer";
import { ParticipantSignIn } from "../ParticipantSignIn";
export const dynamic = "force-dynamic";
export default function PracticePage() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.BASE_UI_PREVIEW_ENABLED !== "true"
  )
    notFound();
  const draft = learningDraftFixture,
    layout = generateLayout(draft.entries.map((e) => e.answer));
  return (
    <>
      <LessonPlayer
        id="practice"
        practice
        practiceAnswers={draft.entries.map((entry) => entry.answer)}
        wallet={{ enabled: false, sponsoredGas: false, proxyUrl: null }}
        initial={{
          id: "practice",
          revision: 1,
          title: draft.title,
          paragraphs: draft.paragraphs.map((p) => p.text),
          clues: draft.entries.map((e) => ({
            clue: e.clue,
            length: e.answer.length,
          })),
          layout,
          layoutHash: layoutHash(layout),
          termsHash: "",
          publicationHash: "",
          publishedAt: "",
          onChainId: "0",
          availability: "CLOSED",
          remainingSlots: 0,
          paidCount: 0,
          terms: {
            chainId: 84532,
            escrow: "",
            sponsor: "",
            token: "",
            rewardAtomic: "0",
            maxClaims: 0,
            startsAt: 0,
            endsAt: 0,
            claimDeadline: 0,
          },
          asOf: { blockNumber: "0", blockHash: "" },
        }}
      />
      <section className="learn-reward" aria-labelledby="account-preview-title">
        <div className="learn-section-heading">
          <h2 id="account-preview-title">Reward account</h2>
        </div>
        <ParticipantSignIn returnTo="/learn/preview" />
      </section>
    </>
  );
}
