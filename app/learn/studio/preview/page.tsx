import { notFound } from "next/navigation";
import {
  learningDraftFixture,
  learningSourceFixture,
} from "../../../../src/server/v2/learning-draft.fixture";
import { SponsorEditor } from "../SponsorEditor";
export const dynamic = "force-dynamic";
export default function StudioPreview() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.BASE_UI_PREVIEW_ENABLED !== "true"
  )
    notFound();
  return (
    <SponsorEditor
      id="new"
      preview
      initial={{
        source: learningSourceFixture,
        draft: learningDraftFixture,
        terms: {
          chainId: 84532,
          token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
          escrow: "",
          sponsor: "",
          initialSigner: "",
          rewardAtomic: "100000",
          maxClaims: 100,
          startsAt: 0,
          endsAt: 0,
          claimDeadline: 0,
        },
      }}
    />
  );
}
