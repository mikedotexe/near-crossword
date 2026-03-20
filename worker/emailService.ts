import { Resend } from "resend";
import config from "./config.js";

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;
const FROM = "NEAR Crossword <noreply@crossword.xyz>";

async function send(to: string, subject: string, html: string): Promise<void> {
  if (!resend) return;
  try {
    await resend.emails.send({ from: FROM, to, subject, html });
  } catch (err: any) {
    console.warn(`[email] Failed to send to ${to}:`, err.message);
  }
}

export async function sendOptionsReady(
  to: string,
  variationSummary: string
): Promise<void> {
  await send(
    to,
    "Your crossword variations are ready!",
    `<p>We've generated crossword variations for you to choose from:</p>
     <pre>${variationSummary}</pre>
     <p>Reply in the marketplace to pick your favorite!</p>`
  );
}

export async function sendPreviewConfirmed(
  to: string,
  preview: string
): Promise<void> {
  await send(
    to,
    "Crossword preview confirmed",
    `<p>Your crossword preview has been confirmed:</p>
     <pre>${preview}</pre>
     <p>Proceeding to payment and scheduling.</p>`
  );
}

export async function sendPaymentReceived(
  to: string,
  rewardAmount: string,
  scheduledAt: string | null
): Promise<void> {
  const scheduleInfo = scheduledAt
    ? `Your puzzle is scheduled to go live at ${scheduledAt}.`
    : "Your puzzle will go live immediately.";

  await send(
    to,
    "Payment received — puzzle is being prepared",
    `<p>We've received your ${rewardAmount} NEAR deposit.</p>
     <p>${scheduleInfo}</p>
     <p>We'll send another email when your puzzle is live!</p>`
  );
}

export async function sendJobCompleted(
  to: string,
  jobId: string
): Promise<void> {
  const appUrl = config.crosswordUrl;
  await send(
    to,
    "Your crossword clues are ready!",
    `<p>Your AI-generated crossword variations are ready.</p>
     <p><a href="${appUrl}/my-jobs?highlight=${jobId}">View and choose a variation</a></p>`
  );
}

export async function sendPuzzleLive(
  to: string,
  puzzleUrl: string,
  txHash: string,
  explorerBase: string
): Promise<void> {
  await send(
    to,
    "Your crossword puzzle is LIVE!",
    `<p>Your crossword puzzle is now live and ready to be solved!</p>
     <p><a href="${puzzleUrl}">Play it here</a></p>
     <p><a href="${explorerBase}/${txHash}">View transaction</a></p>`
  );
}
