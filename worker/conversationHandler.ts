import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import { utils } from "near-api-js";
import config from "./config.js";
import {
  generateClues,
  formatVariationsMessage,
} from "./clueGenerator.js";
import { buildPuzzle, renderAsciiPreview, renderSanitizedPreview } from "./puzzleBuilder.js";
import { submitNewPuzzle, reservePuzzle, getAccountBalanceYocto } from "./chainSubmitter.js";
import { sendMessage, readMessages, submitDeliverable } from "./marketClient.js";
import { tweetNewPuzzle } from "./tweetPublisher.js";
import * as db from "./db.js";
import * as email from "./emailService.js";
import type { Intent, ConversationState, Variation, CluePair, PuzzleResult, MarketMessage } from "./types.js";

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
- {"intent": "confirm_preview"} (user confirms the grid preview, e.g. "confirm", "yes", "looks good")
- {"intent": "reject_preview"} (user wants to go back from preview, e.g. "back", "revise", "change")
- {"intent": "provide_email", "email": "user@example.com"} (user provides an email address)
- {"intent": "provide_schedule", "datetime": "2025-03-15T15:00:00Z"} (user specifies when puzzle should go live, or "now" for immediate)
- {"intent": "sent_confirmation"}
- {"intent": "unknown", "summary": "brief description"}

Parse reward amounts as strings. If the message contains both a variation choice and a reward amount, use "choice_and_reward".
When state is AWAITING_PREVIEW_CONFIRM, use confirm_preview or reject_preview intents.
When state is AWAITING_SCHEDULE, use provide_schedule for timing responses, or reward_amount if they specify a different reward.
An email address can appear alongside any other intent — extract it if present.
For scheduling, parse natural language dates into ISO 8601 format. "now" or "immediately" should use datetime "now".`,
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
  puzzleDbId: string;
  state: ConversationState;
  variations: Variation[] | null;
  chosenPairs: CluePair[] | null;
  rewardAmount: string | null;
  previewPuzzle: PuzzleResult | null;
  lastMessageCount: number;
  userEmail: string | null;
  scheduledAt: string | null;
  uuid: string | null;
  prePaymentBalanceYocto: bigint | null;
  previewText: string | null;

  constructor(assignmentId: string, jobId: string, jobDescription: string, puzzleDbId: string) {
    this.assignmentId = assignmentId;
    this.jobId = jobId;
    this.jobDescription = jobDescription;
    this.puzzleDbId = puzzleDbId;
    this.state = "GENERATING";
    this.variations = null;
    this.chosenPairs = null;
    this.rewardAmount = null;
    this.previewPuzzle = null;
    this.lastMessageCount = 0;
    this.userEmail = null;
    this.scheduledAt = null;
    this.uuid = null;
    this.prePaymentBalanceYocto = null;
    this.previewText = null;
  }

  async start() {
    console.log(
      `[assignment:${this.assignmentId}] Generating clues from job description...`
    );

    try {
      let content = this.jobDescription;

      await sendMessage(
        this.assignmentId,
        `Thanks! I'm generating crossword variations now. While I work — what's your email for updates? (Optional)`
      );

      this.variations = await generateClues(content);
      const msg = formatVariationsMessage(this.variations);
      await sendMessage(this.assignmentId, msg);

      this.state = "AWAITING_CHOICE";
      await db.updatePuzzleStatus(this.puzzleDbId, "awaiting_choice", {
        variations_json: JSON.stringify(this.variations),
      });
      this.lastMessageCount = 1;
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
      await db.updatePuzzleStatus(this.puzzleDbId, "error", {
        last_error: err.message,
      });
    }
  }

  async poll() {
    if (this.state === "DELIVERED" || this.state === "COMMITTING" || this.state === "RESERVING" || this.state === "AWAITING_ACTIVATION") {
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

    const allMessages: MarketMessage[] = Array.isArray(messages) ? messages : messages.messages || [];
    if (allMessages.length <= this.lastMessageCount) return;

    const newMessages = allMessages.slice(this.lastMessageCount);
    this.lastMessageCount = allMessages.length;

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

    // Persist last_message_count after each poll cycle
    await db.updatePuzzleStatus(this.puzzleDbId, this.state.toLowerCase(), {
      last_message_count: this.lastMessageCount,
    });
  }

  async handleMessage(body: string) {
    const intent = await parseIntent(body, this.state);
    console.log(
      `[assignment:${this.assignmentId}] Parsed intent:`,
      JSON.stringify(intent)
    );

    // Extract email from any intent if present
    if (intent.intent === "provide_email" && intent.email) {
      this.userEmail = intent.email;
      await db.updatePuzzleStatus(this.puzzleDbId, this.state.toLowerCase(), {
        email: intent.email,
      });
      console.log(`[assignment:${this.assignmentId}] Email collected: ${intent.email}`);
    }

    switch (this.state) {
      case "AWAITING_CHOICE":
        await this.handleChoiceState(intent);
        break;
      case "AWAITING_PREVIEW_CONFIRM":
        await this.handlePreviewState(intent);
        break;
      case "AWAITING_SCHEDULE":
        await this.handleScheduleState(intent);
        break;
      case "AWAITING_PAYMENT":
        await this.handlePaymentState(intent);
        break;
      case "ERROR":
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

    if (intent.intent === "provide_email") {
      await sendMessage(
        this.assignmentId,
        `Got it, we'll send updates to ${(intent as any).email}. Now please choose variation A or B, or paste your own clues.`
      );
      return;
    }

    if (intent.intent === "edited_pairs") {
      this.chosenPairs = intent.pairs;
      if (!this.rewardAmount) {
        await sendMessage(
          this.assignmentId,
          `Got your custom clue/answer pairs (${intent.pairs.length} words). How much NEAR should the puzzle reward be? (minimum 5)`
        );
        return;
      }
      await this.transitionToPreview();
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
      await this.transitionToPreview();
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

  async transitionToPreview() {
    this.previewPuzzle = buildPuzzle(this.chosenPairs!);
    const preview = renderAsciiPreview(this.previewPuzzle.answers, this.previewPuzzle.dimensions);
    const sanitized = renderSanitizedPreview(this.previewPuzzle.answers, this.previewPuzzle.dimensions);
    this.previewText = preview;
    this.state = "AWAITING_PREVIEW_CONFIRM";
    await db.updatePuzzleStatus(this.puzzleDbId, "awaiting_preview_confirm", {
      chosen_pairs: JSON.stringify(this.chosenPairs),
      reward_amount: this.rewardAmount,
      puzzle_data: JSON.stringify({
        contractAnswers: this.previewPuzzle.contractAnswers,
        dimensions: this.previewPuzzle.dimensions,
        answerPk: this.previewPuzzle.answerPk,
      }),
      preview_text: preview,
      sanitized_preview: sanitized,
      answer_pk: this.previewPuzzle.answerPk,
    });

    if (this.userEmail) {
      await email.sendOptionsReady(this.userEmail, preview);
    }

    await sendMessage(
      this.assignmentId,
      `Here's a preview of your crossword:\n\n${preview}\n\nReply **confirm** to proceed, or **back** to revise your clues.`
    );
  }

  async handlePreviewState(intent: Intent) {
    if (intent.intent === "confirm_preview") {
      if (this.userEmail) {
        const preview = this.previewText || "";
        await email.sendPreviewConfirmed(this.userEmail, preview);
      }
      await this.transitionToSchedule();
      return;
    }
    if (intent.intent === "reject_preview" || intent.intent === "retry") {
      this.chosenPairs = null;
      this.rewardAmount = null;
      this.previewPuzzle = null;
      this.previewText = null;
      this.state = "AWAITING_CHOICE";
      await db.updatePuzzleStatus(this.puzzleDbId, "awaiting_choice");
      const msg = formatVariationsMessage(this.variations!);
      await sendMessage(this.assignmentId, msg);
      return;
    }
    await sendMessage(
      this.assignmentId,
      `Please reply **confirm** to proceed, or **back** to revise your clues.`
    );
  }

  async transitionToSchedule() {
    this.state = "AWAITING_SCHEDULE";
    await db.updatePuzzleStatus(this.puzzleDbId, "awaiting_schedule");
    await sendMessage(
      this.assignmentId,
      `Great! You've chosen ${this.chosenPairs!.length} clue/answer pairs with a ${this.rewardAmount} NEAR reward.\n\n` +
        `**When should your puzzle go live?** Reply "now" for immediate, or a date/time like "March 15 at 3pm UTC".`
    );
  }

  async handleScheduleState(intent: Intent) {
    if (intent.intent === "reward_amount") {
      const parsed = parseFloat(intent.amount);
      if (isNaN(parsed) || parsed < 5) {
        await sendMessage(
          this.assignmentId,
          "The minimum reward is 5 NEAR. Please specify an amount of 5 or more."
        );
        return;
      }
      this.rewardAmount = String(Math.floor(parsed));
      await db.updatePuzzleStatus(this.puzzleDbId, "awaiting_schedule", {
        reward_amount: this.rewardAmount,
      });
      await sendMessage(
        this.assignmentId,
        `Updated reward to ${this.rewardAmount} NEAR. **When should your puzzle go live?** Reply "now" for immediate, or a date/time.`
      );
      return;
    }

    if (intent.intent === "provide_schedule") {
      const dt = intent.datetime;
      if (dt && dt !== "now") {
        this.scheduledAt = dt;
        await db.updatePuzzleStatus(this.puzzleDbId, "awaiting_schedule", {
          scheduled_at: dt,
        });
      } else {
        this.scheduledAt = null;
      }
      await this.transitionToPayment();
      return;
    }

    await sendMessage(
      this.assignmentId,
      `Please tell me when you'd like your puzzle to go live. Reply "now" for immediate, or a date/time.`
    );
  }

  async transitionToPayment() {
    // Record pre-payment balance for verification
    try {
      this.prePaymentBalanceYocto = await getAccountBalanceYocto();
    } catch (err: any) {
      console.warn(`[assignment:${this.assignmentId}] Could not record pre-payment balance:`, err.message);
      this.prePaymentBalanceYocto = null;
    }

    this.state = "AWAITING_PAYMENT";
    await db.updatePuzzleStatus(this.puzzleDbId, "awaiting_payment", {
      pre_payment_balance: this.prePaymentBalanceYocto?.toString() || null,
    });

    const scheduleNote = this.scheduledAt
      ? `Your puzzle is scheduled for ${this.scheduledAt}.\n\n`
      : `Your puzzle will go live immediately after payment.\n\n`;

    await sendMessage(
      this.assignmentId,
      scheduleNote +
        `Please send **${this.rewardAmount} NEAR** to **${config.nearAccountId}** and reply "sent" when the transfer is complete.\n\n` +
        `Your reward is ${this.rewardAmount} NEAR. To change, reply with a different amount.`
    );
  }

  async verifyPaymentReceived(): Promise<boolean> {
    if (!this.prePaymentBalanceYocto || !this.rewardAmount) return false;

    const expectedDelta = BigInt(utils.format.parseNearAmount(this.rewardAmount)!);

    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      try {
        const currentBalance = await getAccountBalanceYocto();
        const delta = currentBalance - this.prePaymentBalanceYocto;
        if (delta >= expectedDelta) {
          return true;
        }
      } catch (err: any) {
        console.warn(`[assignment:${this.assignmentId}] Balance check attempt ${attempt + 1} failed:`, err.message);
      }
    }

    return false;
  }

  async handlePaymentState(intent: Intent) {
    // Handle reward amount change
    if (intent.intent === "reward_amount") {
      const parsed = parseFloat(intent.amount);
      if (isNaN(parsed) || parsed < 5) {
        await sendMessage(
          this.assignmentId,
          "The minimum reward is 5 NEAR. Please specify an amount of 5 or more."
        );
        return;
      }
      this.rewardAmount = String(Math.floor(parsed));
      // Re-record pre-payment balance since expected amount changed
      try {
        this.prePaymentBalanceYocto = await getAccountBalanceYocto();
      } catch {
        this.prePaymentBalanceYocto = null;
      }
      await db.updatePuzzleStatus(this.puzzleDbId, "awaiting_payment", {
        reward_amount: this.rewardAmount,
        pre_payment_balance: this.prePaymentBalanceYocto?.toString() || null,
      });
      await sendMessage(
        this.assignmentId,
        `Updated reward to ${this.rewardAmount} NEAR. Please send **${this.rewardAmount} NEAR** to **${config.nearAccountId}** and reply "sent".`
      );
      return;
    }

    if (intent.intent !== "sent_confirmation") {
      await sendMessage(
        this.assignmentId,
        `I'm waiting for you to send ${this.rewardAmount} NEAR to ${config.nearAccountId}. Reply "sent" once the transfer is done.\n\nTo change the reward amount, just reply with a different number.`
      );
      return;
    }

    // Payment confirmed — verify deposit
    await sendMessage(this.assignmentId, "Checking for your deposit...");
    const verified = await this.verifyPaymentReceived();
    if (!verified) {
      console.warn(`[assignment:${this.assignmentId}] Payment verification inconclusive, proceeding with warning`);
      await sendMessage(
        this.assignmentId,
        "Note: I couldn't fully verify the deposit on-chain, but I'll proceed. If there's an issue, the on-chain transaction will clarify."
      );
    }

    // Branch based on scheduling
    if (this.scheduledAt) {
      await this.handleReservationPath();
    } else {
      await this.handleImmediatePath();
    }
  }

  async handleReservationPath() {
    this.state = "RESERVING";
    this.uuid = uuidv4();
    await db.updatePuzzleStatus(this.puzzleDbId, "reserved", {
      uuid: this.uuid,
    });
    await sendMessage(this.assignmentId, "Received! Reserving your puzzle slot on-chain...");

    try {
      const txHash = await reservePuzzle(this.uuid, this.rewardAmount!);

      this.state = "AWAITING_ACTIVATION";
      await db.updatePuzzleStatus(this.puzzleDbId, "awaiting_activation", {
        reserve_tx_hash: txHash,
      });

      if (this.userEmail) {
        await email.sendPaymentReceived(this.userEmail, this.rewardAmount!, this.scheduledAt);
      }

      const explorerBase =
        config.nearNetwork === "mainnet"
          ? "https://nearblocks.io/txns"
          : "https://testnet.nearblocks.io/txns";

      await sendMessage(
        this.assignmentId,
        `Puzzle reserved on-chain!\n\n` +
          `Transaction: ${explorerBase}/${txHash}\n` +
          `Scheduled for: ${this.scheduledAt}\n\n` +
          `Your puzzle will be activated automatically at the scheduled time. We'll notify you when it's live!`
      );
      await submitDeliverable(
        this.jobId,
        `Puzzle reserved, scheduled for ${this.scheduledAt}. Reserve tx: ${txHash}`
      );

      console.log(
        `[assignment:${this.assignmentId}] Puzzle reserved, uuid=${this.uuid}, scheduled=${this.scheduledAt}`
      );
    } catch (err: any) {
      console.error(
        `[assignment:${this.assignmentId}] Reservation failed:`,
        err.message
      );
      await sendMessage(
        this.assignmentId,
        `Failed to reserve puzzle on-chain: ${err.message}\nPlease reply "sent" to try again.`
      );
      this.state = "AWAITING_PAYMENT";
      await db.updatePuzzleStatus(this.puzzleDbId, "awaiting_payment", {
        last_error: err.message,
      });
    }
  }

  async handleImmediatePath() {
    this.state = "COMMITTING";
    await sendMessage(this.assignmentId, "Received! Building and committing your puzzle on-chain...");

    try {
      const puzzle = this.previewPuzzle ?? buildPuzzle(this.chosenPairs!);
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

      if (this.userEmail) {
        await email.sendPuzzleLive(this.userEmail, puzzleUrl, txHash, explorerBase);
      }

      try {
        await tweetNewPuzzle({ txHash, rewardAmount: this.rewardAmount!, dimensions: puzzle.dimensions });
      } catch (err: any) {
        console.warn("Tweet failed (non-fatal):", err.message);
      }

      this.state = "DELIVERED";
      await db.updatePuzzleStatus(this.puzzleDbId, "delivered", {
        activate_tx_hash: txHash,
      });
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
      this.state = "AWAITING_PAYMENT";
      await db.updatePuzzleStatus(this.puzzleDbId, "awaiting_payment", {
        last_error: err.message,
      });
    }
  }

  async resumeFromState() {
    const prefix = "(Resuming after a brief interruption)\n\n";

    switch (this.state) {
      case "GENERATING":
        await this.start();
        break;
      case "AWAITING_CHOICE":
        if (this.variations) {
          const msg = formatVariationsMessage(this.variations);
          await sendMessage(this.assignmentId, prefix + msg);
        }
        break;
      case "AWAITING_PREVIEW_CONFIRM":
        if (this.previewText) {
          await sendMessage(
            this.assignmentId,
            prefix + `Here's your crossword preview:\n\n${this.previewText}\n\nReply **confirm** to proceed, or **back** to revise your clues.`
          );
        }
        break;
      case "AWAITING_SCHEDULE":
        await sendMessage(
          this.assignmentId,
          prefix + `**When should your puzzle go live?** Reply "now" for immediate, or a date/time like "March 15 at 3pm UTC".`
        );
        break;
      case "AWAITING_PAYMENT":
        await sendMessage(
          this.assignmentId,
          prefix + `Please send **${this.rewardAmount} NEAR** to **${config.nearAccountId}** and reply "sent" when the transfer is complete.`
        );
        break;
    }
  }

  get isDone(): boolean {
    return this.state === "DELIVERED" || this.state === "AWAITING_ACTIVATION";
  }
}
