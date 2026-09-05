export type LearningLayout = {
  version: "crossword-layout:v1";
  rows: number;
  columns: number;
  entries: Array<{
    index: number;
    number: number;
    row: number;
    column: number;
    direction: "across" | "down";
    length: number;
  }>;
};

export type PublicLesson = {
  id: string;
  revision: number;
  title: string;
  paragraphs: string[];
  clues: Array<{ clue: string; length: number }>;
  layout: LearningLayout;
  layoutHash: string;
  termsHash: string;
  publicationHash: string;
  publishedAt: string;
  terms: {
    chainId: number;
    escrow: string;
    token: string;
    sponsor: string;
    rewardAtomic: string;
    maxClaims: number;
    startsAt: number;
    endsAt: number;
    claimDeadline: number;
  };
  onChainId: string;
  availability: "OPEN" | "NOT_STARTED" | "PAUSED" | "CLOSED" | "EXHAUSTED";
  remainingSlots: number;
  paidCount: number;
  asOf: { blockNumber: string; blockHash: string };
};

export function entryCells(
  entry: LearningLayout["entries"][number],
  columns: number,
) {
  return Array.from(
    { length: entry.length },
    (_, offset) =>
      (entry.row + (entry.direction === "down" ? offset : 0)) * columns +
      entry.column +
      (entry.direction === "across" ? offset : 0),
  );
}

export function usdcAmount(atomic: string) {
  const amount = BigInt(atomic);
  return `${amount / 1000000n}.${(amount % 1000000n).toString().padStart(6, "0")}`.replace(
    /\.?0+$/,
    "",
  );
}
