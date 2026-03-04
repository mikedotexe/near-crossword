import Anthropic from "@anthropic-ai/sdk";
import config from "./config.js";
import {
  generateClues,
  formatVariationsMessage,
  fetchUrlContent,
} from "./clueGenerator.js";
import { buildPuzzle } from "./puzzleBuilder.js";
import { submitNewPuzzle } from "./chainSubmitter.js";
import { sendMessage, readMessages, submitDeliverable } from "./marketClient.js";
import { tweetNewPuzzle } from "./tweetPublisher.js";
import type { Intent, ConversationState, Variation, CluePair, MarketMessage } from "./types.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

async function parseIntent(message: string, currentState: ConversationState): Promise<Intent> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: `You parse user messages in a crossword puzzle ordering conversation.
Current state: ${currentState}

Return ONLY valid JSON (no markdown) with one of these structures:
- {"intent": "choose", "variation": "A"} or {"intent": "choose", "variation": "B"}
- {"intent": "retry"}
- {"intent": "edited_pairs", "pairs": [{"clue": "...", "answer": "..."}, ...]}
- {"intent": "reward_amount", "amount": "5"}
- {"intent": "choice_and_reward", "variation": "A", "amount": "5"}
- {"intent": "sent_confirmation"}
- {"intent": "unknown", "summary": "brief description"}

Parse reward amounts as strings. If the message contains both a variation choice and a reward amount, use "choice_and_reward".`,
    messages: [{ role: "user", content: message }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { intent: "unknown", summary: text.slice(0, 200) };
  }
}

export class ConversationHandler {
  assignmentId: string;
  jobId: string;
  jobDescription: string;
  state: ConversationState;
  variations: Variation[] | null;
  chosenPairs: CluePair[] | null;
  rewardAmount: string | null;
  lastMessageCount: number;

  constructor(assignmentId: string, jobId: string, jobDescription: string) {
    this.assignmentId = assignmentId;
    this.jobId = jobId;
    this.jobDescription = jobDescription;
    this.state = "GENERATING";
    this.variations = null;
    this.chosenPairs = null;
    this.rewardAmount = null;
    this.lastMessageCount = 0;
  }

  async start() {
    console.log(
      `[assignment:${this.assignmentId}] Generating clues from job description...`
    );

    try {
      // Gather content: job description + any URLs
      let content = this.jobDescription;

      this.variations = await generateClues(content);
      const msg = formatVariationsMessage(this.variations);
      await sendMessage(this.assignmentId, msg);
      this.state = "AWAITING_CHOICE";
      this.lastMessageCount = 1; // We just sent one message
      console.log(
        `[assignment:${this.assignmentId}] Sent variations, awaiting choice`
      );
    } catch (err: any) {
      console.error(
        `[assignment:${this.assignmentId}] Clue generation failed:`,
        err.message
      );
      await sendMessage(
        this.assignmentId,
        `Sorry, I encountered an error generating clues: ${err.message}\nPlease try posting a new job or reply "retry" and I'll try again.`
      );
      this.state = "ERROR";
    }
  }

  async poll() {
    if (this.state === "DELIVERED" || this.state === "COMMITTING") {
      return;
    }

    let messages;
    try {
      messages = await readMessages(this.assignmentId);
    } catch (err: any) {
      console.error(
        `[assignment:${this.assignmentId}] Failed to read messages:`,
        err.message
      );
      return;
    }

    // Only process new messages from the requester
    const allMessages: MarketMessage[] = Array.isArray(messages) ? messages : messages.messages || [];
    if (allMessages.length <= this.lastMessageCount) return;

    const newMessages = allMessages.slice(this.lastMessageCount);
    this.lastMessageCount = allMessages.length;

    // Process the latest requester message
    const requesterMessages = newMessages.filter(
      (m) => m.role === "requester" || m.sender === "requester"
    );
    if (requesterMessages.length === 0) return;

    const latest = requesterMessages[requesterMessages.length - 1];
    const body = latest.body || latest.content || latest.text || "";

    try {
      await this.handleMessage(body);
    } catch (err: any) {
      console.error(
        `[assignment:${this.assignmentId}] Error handling message:`,
        err.message
      );
      await sendMessage(
        this.assignmentId,
        `I encountered an error: ${err.message}\nPlease try again or reply "retry".`
      );
    }
  }

  async handleMessage(body: string) {
    const intent = await parseIntent(body, this.state);
    console.log(
      `[assignment:${this.assignmentId}] Parsed intent:`,
      JSON.stringify(intent)
    );

    switch (this.state) {
      case "AWAITING_CHOICE":
        await this.handleChoiceState(intent);
        break;
      case "AWAITING_PAYMENT":
        await this.handlePaymentState(intent);
        break;
      case "ERROR":
        // Allow retry from error state
        if (intent.intent === "retry") {
          this.state = "GENERATING";
          await this.start();
        }
        break;
      default:
        await sendMessage(
          this.assignmentId,
          "I'm not sure how to handle that right now. Please wait a moment."
        );
    }
  }

  async handleChoiceState(intent: Intent) {
    if (intent.intent === "retry") {
      this.state = "GENERATING";
      await this.start();
      return;
    }

    if (intent.intent === "edited_pairs") {
      this.chosenPairs = intent.pairs;
      if (!this.rewardAmount) {
        await sendMessage(
          this.assignmentId,
          `Got your custom clue/answer pairs (${intent.pairs.length} words). How much NEAR should the puzzle reward be? (minimum 5)`
        );
        // Stay in AWAITING_CHOICE to also get reward amount
        return;
      }
      await this.transitionToPayment();
      return;
    }

    let variation: string | null = null;
    let amount: string | null = null;

    if (intent.intent === "choice_and_reward") {
      variation = intent.variation;
      amount = intent.amount;
    } else if (intent.intent === "choose") {
      variation = intent.variation;
    } else if (intent.intent === "reward_amount") {
      amount = intent.amount;
    }

    if (variation) {
      const v = this.variations?.find(
        (v) => v.label.toUpperCase() === variation!.toUpperCase()
      );
      if (v) {
        this.chosenPairs = v.pairs;
      } else {
        await sendMessage(
          this.assignmentId,
          `I didn't recognize variation "${variation}". Please choose A or B.`
        );
        return;
      }
    }

    if (amount) {
      const parsed = parseFloat(amount);
      if (isNaN(parsed) || parsed < 5) {
        await sendMessage(
          this.assignmentId,
          "The minimum reward is 5 NEAR. Please specify an amount of 5 or more."
        );
        return;
      }
      this.rewardAmount = String(Math.floor(parsed));
    }

    if (this.chosenPairs && this.rewardAmount) {
      await this.transitionToPayment();
    } else if (this.chosenPairs && !this.rewardAmount) {
      await sendMessage(
        this.assignmentId,
        `Great choice! How much NEAR should the puzzle reward be? (minimum 5)`
      );
    } else if (!this.chosenPairs && this.rewardAmount) {
      await sendMessage(
        this.assignmentId,
        `Got the reward amount (${this.rewardAmount} NEAR). Now please choose variation A or B, or paste your own clues.`
      );
    } else {
      await sendMessage(
        this.assignmentId,
        "Please choose variation A or B, reply 'retry' for new variations, or paste your own clue/answer pairs."
      );
    }
  }

  async transitionToPayment() {
    this.state = "AWAITING_PAYMENT";
    await sendMessage(
      this.assignmentId,
      `Great! You've chosen ${this.chosenPairs!.length} clue/answer pairs with a ${this.rewardAmount} NEAR reward.\n\n` +
        `Please send **${this.rewardAmount} NEAR** to **${config.nearAccountId}** and then reply "sent" when the transfer is complete.\n\n` +
        `This deposit will be attached to the puzzle as the solver's reward.`
    );
  }

  async handlePaymentState(intent: Intent) {
    if (intent.intent !== "sent_confirmation") {
      await sendMessage(
        this.assignmentId,
        `I'm waiting for you to send ${this.rewardAmount} NEAR to ${config.nearAccountId}. Reply "sent" once the transfer is done.`
      );
      return;
    }

    this.state = "COMMITTING";
    await sendMessage(this.assignmentId, "Received! Building and committing your puzzle on-chain...");

    try {
      const puzzle = buildPuzzle(this.chosenPairs!);
      const txHash = await submitNewPuzzle(
        puzzle.answerPk,
        puzzle.dimensions,
        puzzle.contractAnswers,
        this.rewardAmount!
      );

      const explorerBase =
        config.nearNetwork === "mainnet"
          ? "https://nearblocks.io/txns"
          : "https://testnet.nearblocks.io/txns";

      const puzzleUrl = config.crosswordUrl;
      const deliverableMsg =
        `Puzzle is live!\n\n` +
        `Play at: ${puzzleUrl}\n` +
        `Transaction: ${explorerBase}/${txHash}\n` +
        `Reward: ${this.rewardAmount} NEAR\n` +
        `Grid: ${puzzle.dimensions.x}x${puzzle.dimensions.y} with ${this.chosenPairs!.length} words`;

      await sendMessage(this.assignmentId, deliverableMsg);
      await submitDeliverable(this.jobId, deliverableMsg);

      try {
        await tweetNewPuzzle({ txHash, rewardAmount: this.rewardAmount!, dimensions: puzzle.dimensions });
      } catch (err: any) {
        console.warn("Tweet failed (non-fatal):", err.message);
      }

      this.state = "DELIVERED";
      console.log(
        `[assignment:${this.assignmentId}] Puzzle delivered! tx=${txHash}`
      );
    } catch (err: any) {
      console.error(
        `[assignment:${this.assignmentId}] On-chain commit failed:`,
        err.message
      );
      await sendMessage(
        this.assignmentId,
        `Failed to commit puzzle on-chain: ${err.message}\n\nPlease contact support or reply "retry" to try the commit again.`
      );
      // Stay in AWAITING_PAYMENT so they can say "sent" again
      this.state = "AWAITING_PAYMENT";
    }
  }

  get isDone(): boolean {
    return this.state === "DELIVERED";
  }
}
