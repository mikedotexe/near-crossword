import { expect, test } from "@playwright/test";
import {
  fillPuzzle,
  id,
  layoutReview,
  lesson,
  material,
  noOverflow,
} from "./learning.fixture";

test("Base-first home leads to both public product demos", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Crossword", level: 1 })).toBeVisible();
  await expect(page.getByText("Sponsor-funded learning / Base")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "The best experience belongs on Base.",
      level: 3,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/Base campaigns have no network integration fee/),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Try a lesson", exact: true }).first()).toHaveAttribute("href", "/learn/practice");
  await expect(page.getByRole("link", { name: "See the sponsor workflow", exact: true })).toHaveAttribute("href", "/learn/sponsor-demo");
  const rail = await page.locator(".rail-strip").boundingBox();
  expect(rail?.y).toBeLessThan(page.viewportSize()!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("base-home-desktop.png"), fullPage: true });
});

test("public practice grid checks answers and persists guesses without claiming a reward", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/learn/practice");
  await expect(page.getByText("Practice / No reward")).toBeVisible();
  await fillPuzzle(page);
  await page
    .getByRole("button", { name: "Check crossword", exact: true })
    .click();
  await expect(
    page.getByText("Correct. You completed the practice lesson."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Row 1, column 2", { exact: true })).toHaveValue(
    "L",
  );
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("player-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Clear puzzle", exact: true }).click();
  await expect(page.getByLabel("Row 1, column 2", { exact: true })).toHaveValue(
    "",
  );
  expect(errors).toEqual([]);
});

test("public sponsor demo does not persist changes", async ({ page }) => {
  await page.goto("/learn/sponsor-demo");
  await expect(page.getByText("Sponsor workflow demo / Saving disabled")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
});

test("anonymous learner solves before sign-in and returns to the same lesson", async ({
  page,
}) => {
  await page.route(`**/api/base/lessons/${id}`, (route) =>
    route.fulfill({ json: lesson }),
  );
  await page.route(`**/api/base/participants/${id}/**`, (route) =>
    route.fulfill({
      status: 401,
      json: { error: { message: "Sign in required" } },
    }),
  );
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({
      json: { email: { id: "email", type: "email", name: "Email" } },
    }),
  );
  await page.goto(`/learn/${id}`);
  await fillPuzzle(page);
  await page
    .getByRole("button", { name: "Check crossword", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Sign in to save your completion", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`callbackUrl=.*${id}`));
  await expect(
    page.getByRole("heading", { name: "Continue with Crossword." }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("Row 1, column 2", { exact: true })).toHaveValue(
    "L",
  );
});

test("completion and optional consent stay separate; only recovery's receipt displays paid", async ({
  page,
}, info) => {
  let completed = false,
    paid = false,
    shareEmail = false,
    version = 0,
    recoveryReads = 0;
  await page.route(`**/api/base/lessons/${id}`, (route) =>
    route.fulfill({ json: lesson }),
  );
  await page.route(`**/api/base/participants/${id}/**`, async (route) => {
    const url = route.request().url();
    if (url.endsWith("/completion")) {
      expect(route.request().postDataJSON().answers).toEqual([
        "WALLET",
        "LEDGER",
        "TRANSFER",
      ]);
      completed = true;
      return route.fulfill({ json: { status: "COMPLETED" } });
    }
    if (url.endsWith("/consent")) {
      const body = route.request().postDataJSON();
      expect(body.expectedVersion).toBe(version);
      shareEmail = body.shareEmail;
      version++;
      return route.fulfill({ json: { shareEmail, version } });
    }
    recoveryReads++;
    return route.fulfill({
      json: {
        status: paid ? "PAID" : "NOT_ALLOCATED",
        completed,
        emailVerified: true,
        revision: 1,
        consent: { shareEmail, version },
        chainId: 84532,
        ...(paid
          ? {
              amountAtomic: "100000",
              recipient: `0x${"33".repeat(20)}`,
              receipt: { transactionHash: `0x${"aa".repeat(32)}` },
            }
          : {}),
      },
    });
  });
  await page.goto(`/learn/${id}`);
  await fillPuzzle(page);
  await page
    .getByRole("button", { name: "Check crossword", exact: true })
    .click();
  await expect(
    page.getByText(/Puzzle complete. Your completion is saved/),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  const readsBeforeConsent = recoveryReads;
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.getByRole("checkbox").uncheck();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  expect(recoveryReads).toBe(readsBeforeConsent);
  await expect(
    page.getByText(/Sponsored wallet claims are not enabled/),
  ).toBeVisible();
  await expect(
    page.getByText("0.1 USDC received", { exact: true }),
  ).toHaveCount(0);
  paid = true;
  await page
    .getByRole("button", { name: "Check reward status", exact: true })
    .click();
  await expect(
    page.getByText("0.1 USDC received", { exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("reward-desktop.png"),
    fullPage: true,
  });
});

test("sponsor reviews content and layout, links funding, publishes and withdraws the exact revision", async ({
  page,
}, info) => {
  let approved = false,
    funded = false,
    gridApproved = false,
    published = false;
  await page.route(`**/api/base/reviews/${id}**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/publication")) {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        expect(body.expected).toEqual({
          revision: 1,
          termsHash: material.termsHash,
          layoutHash: layoutReview.layoutHash,
        });
        if (body.action === "approve-layout") gridApproved = true;
        if (body.action === "bind") {
          expect(body.onChainId).toBe("1");
          funded = true;
        }
        if (body.action === "publish") published = true;
        if (body.action === "withdraw") published = false;
      }
      return route.fulfill({
        json: { ...layoutReview, approved: gridApproved, published },
      });
    }
    if (url.pathname.endsWith("/approve")) {
      expect(route.request().postDataJSON().reviewHash).toBe(
        material.reviewHash,
      );
      approved = true;
    }
    return route.fulfill({
      json: {
        ...material,
        id,
        revision: 1,
        status: approved ? "APPROVED" : "REQUIRES_REVIEW",
        approval: approved
          ? { reviewerId: "1", approvedAt: new Date().toISOString() }
          : null,
        fundingBound: funded,
      },
    });
  });
  await page.goto(`/learn/studio/${id}`);
  await expect(page.getByLabel("Lesson title", { exact: true })).toHaveValue(
    material.publicContent.title,
  );
  await page.getByRole("tab", { name: "Review & publish" }).click();
  await page
    .getByRole("button", { name: "Approve lesson and terms", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review crossword layout", exact: true })
    .click();
  await expect(page.getByLabel("Row 1, column 2", { exact: true })).toHaveValue(
    "L",
  );
  await page
    .getByRole("button", { name: "Approve this layout", exact: true })
    .click();
  await page.getByLabel("On-chain campaign number", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "Verify and link funding", exact: true })
    .click();
  await expect(
    page.getByText(/Finalized funding linked. No transaction was sent/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Publish this lesson", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "View public lesson", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("sponsor-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Withdraw listing", exact: true })
    .click();
  await expect(
    page.getByText(/Listing withdrawn. Existing reward recovery/),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Lesson & sources" }).click();
  await expect(page.getByLabel("Lesson title", { exact: true })).toBeDisabled();
});

test("unavailable public API never substitutes practice content or an invented payout", async ({
  page,
}) => {
  await page.route("**/api/base/**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "Finalized reward state is unavailable" } },
    }),
  );
  await page.goto(`/learn/${id}`);
  await expect(
    page.getByText("Finalized reward state is unavailable").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Crossword", exact: true }),
  ).toHaveCount(0);
});
