import config from "./config.js";
import { pollJobs, placeBid, getMyBids } from "./marketClient.js";
import { ConversationHandler } from "./conversationHandler.js";
import * as db from "./db.js";
import { runSchedulerTick } from "./scheduler.js";
import { processAsyncJobs } from "./asyncJobProcessor.js";

// Track active conversations by assignmentId
const activeConversations = new Map<string, ConversationHandler>();
// Track jobs we've already bid on to avoid duplicates
const bidJobIds = new Set<string>();

async function discoverAndBid() {
  let jobs: any;
  try {
    jobs = await pollJobs(config.matchTags);
  } catch (err: any) {
    console.error("Failed to poll jobs:", err.message);
    return;
  }

  const jobList = Array.isArray(jobs) ? jobs : jobs.jobs || [];
  if (jobList.length === 0) return;

  for (const job of jobList) {
    const jobId = job.id || job.job_id;
    if (bidJobIds.has(jobId)) continue;

    console.log(`[discover] Found new job: ${jobId} — "${(job.title || job.description || "").slice(0, 80)}"`);

    try {
      await placeBid(jobId, 0, "I can create a crossword puzzle from your content with a NEAR token reward. I'll generate 2 variations for you to choose from.");
      bidJobIds.add(jobId);
      console.log(`[discover] Placed bid on job ${jobId}`);
    } catch (err: any) {
      console.error(`[discover] Failed to bid on job ${jobId}:`, err.message);
    }
  }
}

async function checkBidsAndStartConversations() {
  let bids: any;
  try {
    bids = await getMyBids();
  } catch (err: any) {
    console.error("Failed to fetch bids:", err.message);
    return;
  }

  const bidList = Array.isArray(bids) ? bids : bids.bids || [];

  for (const bid of bidList) {
    const status = bid.status || "";
    if (status !== "accepted") continue;

    const assignmentId = bid.assignment_id;
    if (!assignmentId || activeConversations.has(assignmentId)) continue;

    const jobId = bid.job_id;
    const jobDescription = bid.job_description || bid.job?.description || "";

    console.log(`[bids] Bid accepted for job ${jobId}, assignment ${assignmentId}`);

    try {
      // Create DB row for this puzzle
      const puzzleDbId = await db.createPuzzle({
        assignment_id: assignmentId,
        job_id: jobId,
        source_content: jobDescription,
      });

      const handler = new ConversationHandler(
        assignmentId,
        jobId,
        jobDescription,
        puzzleDbId
      );
      activeConversations.set(assignmentId, handler);

      handler.start().catch((err: any) => {
        console.error(`[bids] Failed to start conversation for ${assignmentId}:`, err.message);
      });
    } catch (err: any) {
      // If puzzle already exists in DB (duplicate assignment), just skip
      if (err.message?.includes("unique")) {
        console.log(`[bids] Assignment ${assignmentId} already exists in DB, skipping`);
      } else {
        console.error(`[bids] Failed to create puzzle for ${assignmentId}:`, err.message);
      }
    }
  }
}

async function restoreActiveConversations() {
  try {
    const rows = await db.getNonTerminalPuzzles();
    for (const row of rows) {
      if (!row.assignment_id || activeConversations.has(row.assignment_id)) continue;
      // Skip puzzles awaiting activation — the scheduler handles those
      if (row.status === "awaiting_activation") continue;

      console.log(`[restore] Restoring conversation for assignment ${row.assignment_id}, status=${row.status}`);

      const handler = new ConversationHandler(
        row.assignment_id,
        row.job_id || "",
        row.source_content || "",
        row.id
      );

      // Restore state from DB
      handler.state = row.status.toUpperCase() as any;
      handler.variations = row.variations_json || null;
      handler.chosenPairs = row.chosen_pairs || null;
      handler.rewardAmount = row.reward_amount || null;
      handler.previewPuzzle = row.puzzle_data || null;
      handler.userEmail = row.email || null;
      handler.scheduledAt = row.scheduled_at ? row.scheduled_at.toISOString() : null;
      handler.uuid = row.uuid || null;
      handler.lastMessageCount = row.last_message_count || 0;
      handler.previewText = row.preview_text || null;

      activeConversations.set(row.assignment_id, handler);

      handler.resumeFromState().catch((err: any) => {
        console.error(`[restore] Failed to resume ${row.assignment_id}:`, err.message);
      });
    }
    if (rows.length > 0) {
      console.log(`[restore] Restored ${activeConversations.size} active conversations`);
    }
  } catch (err: any) {
    console.error("[restore] Failed to restore conversations:", err.message);
  }
}

async function pollActiveConversations() {
  for (const [assignmentId, handler] of activeConversations) {
    if (handler.isDone) {
      activeConversations.delete(assignmentId);
      continue;
    }

    try {
      await handler.poll();
    } catch (err: any) {
      console.error(`[poll] Error polling assignment ${assignmentId}:`, err.message);
    }
  }
}

async function tick() {
  await discoverAndBid();
  await checkBidsAndStartConversations();
  await pollActiveConversations();
  await runSchedulerTick();
  await processAsyncJobs();
}

async function main() {
  console.log("NEAR Crossword Agent Worker starting...");
  console.log(`  Network: ${config.nearNetwork}`);
  console.log(`  Account: ${config.nearAccountId}`);
  console.log(`  Market:  ${config.marketUrl}`);
  console.log(`  Tags:    ${config.matchTags.join(", ")}`);
  console.log(`  Poll:    every ${config.pollIntervalMs}ms`);
  console.log(`  DB:      ${config.databaseUrl ? "connected" : "NOT SET"}`);
  console.log("");

  // Restore any in-progress conversations from DB
  await restoreActiveConversations();

  // Run first tick immediately
  await tick();

  // Then poll on interval
  setInterval(async () => {
    try {
      await tick();
    } catch (err: any) {
      console.error("[main] Tick error:", err.message);
    }
  }, config.pollIntervalMs);
}

main().catch((err) => {
  console.error("Agent worker failed to start:", err);
  process.exit(1);
});
