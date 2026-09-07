import { generateLayout, layoutHash } from "../../../src/server/base/layout";
import { learningDraftFixture } from "../../../src/server/v2/learning-draft.fixture";
import { LessonPlayer } from "../LessonPlayer";

export const dynamic = "force-dynamic";

export default function PracticePage() {
  const draft = learningDraftFixture;
  const layout = generateLayout(draft.entries.map((entry) => entry.answer));
  return (
    <LessonPlayer
      id="practice"
      practice
      practiceAnswers={draft.entries.map((entry) => entry.answer)}
      wallet={{ enabled: false, sponsoredGas: false, proxyUrl: null }}
      initial={{
        id: "practice",
        revision: 1,
        title: draft.title,
        paragraphs: draft.paragraphs.map((paragraph) => paragraph.text),
        clues: draft.entries.map((entry) => ({
          clue: entry.clue,
          length: entry.answer.length,
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
  );
}
