export interface CluePair { clue: string; answer: string }

export interface Variation { label: string; description: string; pairs: CluePair[] }

export interface GridDimensions { x: number; y: number }

export interface LayoutAnswer {
  num: number; start: GridDimensions; direction: string;
  length: number; answer: string; clue: string;
}

export interface ContractAnswer {
  num: number; start: GridDimensions; direction: "Across" | "Down";
  length: number; clue: string;
}

export interface PuzzleResult {
  answers: LayoutAnswer[]; contractAnswers: ContractAnswer[];
  dimensions: GridDimensions; answerPk: string; seedPhrase: string;
}

export type ConversationState =
  "GENERATING" | "AWAITING_CHOICE" | "AWAITING_PAYMENT" | "COMMITTING" | "DELIVERED" | "ERROR";

export type Intent =
  | { intent: "choose"; variation: string }
  | { intent: "retry" }
  | { intent: "edited_pairs"; pairs: CluePair[] }
  | { intent: "reward_amount"; amount: string }
  | { intent: "choice_and_reward"; variation: string; amount: string }
  | { intent: "sent_confirmation" }
  | { intent: "unknown"; summary: string };

export interface TweetPuzzleParams {
  txHash: string; rewardAmount: string; dimensions: GridDimensions;
}

export interface MarketMessage {
  role?: string; sender?: string; body?: string; content?: string; text?: string;
}
