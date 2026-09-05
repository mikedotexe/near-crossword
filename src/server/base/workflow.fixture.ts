import { privateKeyToAccount } from "viem/accounts";
import { learningDraftFixture, learningSourceFixture } from "../v2/learning-draft.fixture";

// Public local-test keys only. No production signer is configured by this fixture.
export const testSigner = privateKeyToAccount(`0x${"11".repeat(32)}`);
export const rotatedTestSigner = privateKeyToAccount(`0x${"22".repeat(32)}`);
export const recipient = "0x3333333333333333333333333333333333333333" as const;
export function reviewFixture(now = Math.floor(Date.now() / 1000)) {
  return structuredClone({
    source: learningSourceFixture, draft: learningDraftFixture,
    terms: {
      chainId: 31337 as const,
      escrow: "0x4444444444444444444444444444444444444444",
      token: "0x5555555555555555555555555555555555555555",
      sponsor: "0x6666666666666666666666666666666666666666",
      initialSigner: testSigner.address,
      rewardAtomic: "100000", maxClaims: 3,
      startsAt: now - 60, endsAt: now + 3600, claimDeadline: now + 90000,
    },
  });
}
