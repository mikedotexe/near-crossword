import { expect, test } from "@playwright/test";

test("home and explore label illustrative campaigns honestly", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /A good clue deserves a great prize/i }),
  ).toBeVisible();
  await expect(page.getByText("Illustrative campaign").first()).toBeVisible();
  await expect(
    page.getByText(/campaign data below is illustrative/i),
  ).toBeVisible();

  await page.getByRole("link", { name: /Find a puzzle/i }).click();
  await expect(
    page.getByRole("heading", { name: /Find the clue that clicks/i }),
  ).toBeVisible();
  await expect(
    page.getByText(/do not represent funded live prizes/i),
  ).toBeVisible();
});

test("manual creator flow freezes a private draft and returns an exact quote", async ({
  page,
}) => {
  await page.goto("/create");

  await expect(
    page.getByRole("heading", { name: "Write a puzzle worth sharing." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Make it feel like your campaign." }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Lock a prize from anywhere." }),
  ).toBeVisible();
  await page
    .getByLabel("Origin-network refund address")
    .fill("0x1111111111111111111111111111111111111111");
  await page.getByLabel("NEAR recovery account").fill("sponsor.testnet");

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Review the promise." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save private draft" }).click();

  await expect(
    page.getByText(/Quote ready.*campaign stays private/i),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Send only the quoted asset and amount.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Funding is not complete until")).toBeVisible();

  await page.getByRole("link", { name: /Open draft/i }).click();
  await expect(page.getByText("Funding not settled")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Continue from the durable receipt." }),
  ).toBeVisible();
  await expect(
    page.getByText(/Funding state recovered from the workflow ledger/i),
  ).toBeVisible();
  await expect(page.getByText("Funded and locked")).toHaveCount(0);
});

test("x402 generation requires a compatible payer before any paid request", async ({
  page,
}) => {
  await page.goto("/create");
  await expect(
    page.getByRole("button", { name: "Connect NEAR payer" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate via x402" }),
  ).toBeDisabled();
  await expect(page.getByText(/Draft added/i)).toHaveCount(0);
});

test("x402 AI uses one payment identifier and a standard paid retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.crosswordCampaignsX402Payer = {
      async createPaymentHeaders() {
        return { "PAYMENT-SIGNATURE": "browser-wallet-owned-signature" };
      },
    };
  });
  const identifiers: string[] = [];
  await page.route("**/api/v2/ai/generate", async (route) => {
    const headers = route.request().headers();
    identifiers.push(headers["idempotency-key"] ?? "");
    if (!headers["payment-signature"]) {
      await route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify({
          x402Version: 2,
          resource: {
            url: "/api/v2/ai/generate",
            description: "AI crossword draft",
            mimeType: "application/json",
          },
          accepts: [
            {
              scheme: "exact",
              network: "near:testnet",
              asset: "usdc.testnet",
              amount: "100000",
              payTo: "merchant.testnet",
              maxTimeoutSeconds: 300,
              extra: {},
            },
          ],
          extensions: {
            "payment-identifier": {
              info: { required: true },
              schema: { type: "object" },
            },
          },
        }),
      });
      return;
    }
    expect(headers["payment-signature"]).toBe(
      "browser-wallet-owned-signature",
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entries: [
          { clue: "A public record", answer: "LEDGER" },
          { clue: "A locked reward", answer: "PRIZE" },
          { clue: "Proof of payment", answer: "RECEIPT" },
          { clue: "Desired outcome", answer: "INTENT" },
        ],
        receiptHandle: {
          version: "x402-ai-generation-receipt:v1",
          paymentIdentifier: identifiers[0],
        },
        cached: false,
      }),
    });
  });

  await page.goto("/create");
  await expect(page.getByText(/Compatible payer available/i)).toBeVisible();
  await page.getByRole("button", { name: "Generate via x402" }).click();
  await expect(page.getByText(/Draft added/i)).toBeVisible();
  expect(identifiers).toHaveLength(2);
  expect(identifiers[0]).toBeTruthy();
  expect(identifiers[1]).toBe(identifiers[0]);
});

test("an unknown campaign is a real 404, not an illustrative prize", async ({
  page,
}) => {
  const response = await page.goto("/campaigns/not-a-real-campaign");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Illustrative campaign")).toHaveCount(0);
});

test("legacy claim access keeps the original contract separate", async ({
  page,
}) => {
  await page.goto("/legacy");
  await expect(
    page.getByRole("heading", { name: "Old prizes stay exactly where they were." }),
  ).toBeVisible();
  await expect(page.getByText("crossword.puzzle.near")).toBeVisible();
  await expect(page.getByText(/Claim continuity, not migration/i)).toBeVisible();
  await expect(page.getByText(/Never enter a seed phrase/i)).toBeVisible();
});

test("a claim receipt URL resumes after navigation and reaches a terminal receipt", async ({
  page,
}) => {
  const claimId = "650386f3-7d35-4d8f-a3df-5090476e616d";
  let reads = 0;
  await page.route(`**/api/v2/claims/${claimId}`, async (route) => {
    reads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        claim: {
          id: claimId,
          campaignId: "demo-open-web",
          status: reads > 1 ? "PAID" : "PAYING",
          contractTxHash: "contract-transaction-receipt",
          settlementTxHash:
            reads > 1 ? "destination-transaction-receipt" : null,
          evidence: {},
        },
      }),
    });
  });

  await page.goto(`/campaigns/open-web-jackpot/play?claim=${claimId}`);
  await expect(
    page.getByRole("heading", { name: "Open Web Jackpot" }),
  ).toBeVisible();
  await expect(page.getByText("Illustrative receipt preview")).toBeVisible();
  await expect(page.getByText("PAYING")).toBeVisible();
  await page.getByRole("button", { name: "Refresh receipt" }).click();
  await expect(page.getByText("PAID")).toBeVisible();
  await expect(page.getByText("destination-transaction-receipt")).toBeVisible();
});
