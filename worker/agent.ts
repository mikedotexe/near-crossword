import config from "./config.js";
import { pollJobs, placeBid, getMyBids } from "./marketClient.js";
import { ConversationHandler } from "./conversationHandler.js";

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

    const handler = new ConversationHandler(
      assignmentId,
      jobId,
      jobDescription
    );
    activeConversations.set(assignmentId, handler);

    // Start the conversation (generate clues, send first message)
    handler.start().catch((err: any) => {
      console.error(`[bids] Failed to start conversation for ${assignmentId}:`, err.message);
    });
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
}

async function main() {
  console.log("NEAR Crossword Agent Worker starting...");
  console.log(`  Network: ${config.nearNetwork}`);
  console.log(`  Account: ${config.nearAccountId}`);
  console.log(`  Market:  ${config.marketUrl}`);
  console.log(`  Tags:    ${config.matchTags.join(", ")}`);
  console.log(`  Poll:    every ${config.pollIntervalMs}ms`);
  console.log("");

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
