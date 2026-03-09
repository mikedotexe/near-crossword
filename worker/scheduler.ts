import config from "./config.js";
import * as db from "./db.js";
import { activatePuzzle } from "./chainSubmitter.js";
import { tweetNewPuzzle } from "./tweetPublisher.js";
import * as email from "./emailService.js";
import type { StorablePuzzleData } from "./types.js";

const MAX_RETRIES = 3;

export async function runSchedulerTick(): Promise<void> {
  let readyPuzzles;
  try {
    readyPuzzles = await db.getPuzzlesReadyToActivate();
  } catch (err: any) {
    console.error("[scheduler] Failed to query ready puzzles:", err.message);
    return;
  }

  for (const puzzle of readyPuzzles) {
    if (puzzle.retry_count >= MAX_RETRIES) {
      console.error(`[scheduler] Puzzle ${puzzle.id} exceeded max retries, marking error`);
      await db.updatePuzzleStatus(puzzle.id, "error", {
        last_error: "Exceeded maximum activation retries",
      });
      continue;
    }

    console.log(`[scheduler] Activating puzzle ${puzzle.id}, uuid=${puzzle.uuid}`);

    try {
      await db.updatePuzzleStatus(puzzle.id, "activating");

      const puzzleData: StorablePuzzleData = puzzle.puzzle_data;
      if (!puzzleData || !puzzle.uuid || !puzzle.answer_pk) {
        throw new Error("Missing puzzle data, uuid, or answer_pk for activation");
      }

      const txHash = await activatePuzzle(
        puzzle.uuid,
        puzzleData.answerPk,
        puzzleData.dimensions,
        puzzleData.contractAnswers
      );

      await db.updatePuzzleStatus(puzzle.id, "active", {
        activate_tx_hash: txHash,
      });

      const explorerBase =
        config.nearNetwork === "mainnet"
          ? "https://nearblocks.io/txns"
          : "https://testnet.nearblocks.io/txns";

      // Send "puzzle is live" email
      if (puzzle.email) {
        await email.sendPuzzleLive(
          puzzle.email,
          config.crosswordUrl,
          txHash,
          explorerBase
        );
      }

      // Tweet (optional)
      try {
        if (puzzleData.dimensions && puzzle.reward_amount) {
          await tweetNewPuzzle({
            txHash,
            rewardAmount: puzzle.reward_amount,
            dimensions: puzzleData.dimensions,
          });
        }
      } catch (err: any) {
        console.warn("[scheduler] Tweet failed (non-fatal):", err.message);
      }

      console.log(
        `[scheduler] Puzzle ${puzzle.id} activated successfully, tx=${txHash}`
      );
    } catch (err: any) {
      console.error(
        `[scheduler] Failed to activate puzzle ${puzzle.id}:`,
        err.message
      );
      await db.updatePuzzleStatus(puzzle.id, "awaiting_activation", {
        last_error: err.message,
        retry_count: (puzzle.retry_count || 0) + 1,
      });
    }
  }
}
