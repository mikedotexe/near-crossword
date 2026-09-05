import { expect, test } from "@playwright/test";
import { id, lesson } from "./learning.fixture";

test("withdrawn public lesson still presents the authenticated finalized reward receipt", async ({
  page,
}) => {
  await page.route(`**/api/base/lessons/${id}`, (route) =>
    route.fulfill({
      status: 404,
      json: { error: { message: "Learning campaign not found" } },
    }),
  );
  await page.route(`**/api/base/participants/${id}/claim`, (route) =>
    route.fulfill({
      json: {
        status: "PAID",
        completed: true,
        emailVerified: true,
        revision: 1,
        chainId: 84532,
        consent: { version: 0, shareEmail: false },
        rewardTerms: { ...lesson.terms, onChainId: lesson.onChainId },
        amountAtomic: "100000",
        recipient: `0x${"33".repeat(20)}`,
        receipt: { transactionHash: `0x${"aa".repeat(32)}` },
      },
    }),
  );
  await page.goto(`/learn/${id}`);
  await expect(
    page.getByText("Learning campaign not found", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("0.1 USDC received", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View finalized receipt", exact: true }),
  ).toHaveAttribute("href", /sepolia.basescan.org\/tx\/0x/);
  await expect(
    page.getByRole("group", { name: "Crossword", exact: true }),
  ).toHaveCount(0);
});
