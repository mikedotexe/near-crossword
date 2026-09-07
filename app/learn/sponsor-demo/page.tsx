import {
  learningDraftFixture,
  learningSourceFixture,
} from "../../../src/server/v2/learning-draft.fixture";
import { SponsorEditor } from "../studio/SponsorEditor";

export const dynamic = "force-dynamic";

export default function SponsorDemoPage() {
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
          escrow: "0x77fdCEF7d08c54eD2a87FD54fBf24a660fa2A304",
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
