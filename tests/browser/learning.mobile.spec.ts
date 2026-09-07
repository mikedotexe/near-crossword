import { expect, test } from "@playwright/test";
import { fillPuzzle, noOverflow } from "./learning.fixture";

test("phone home shows the next section without horizontal overflow", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Crossword", level: 1 })).toBeVisible();
  const rail = await page.locator(".rail-strip").boundingBox();
  expect(rail?.y).toBeLessThan(page.viewportSize()!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("base-home-mobile.png"), fullPage: true });
});

test("phone practice board and private studio fit without page overflow", async ({
  page,
}, info) => {
  await page.goto("/learn/practice");
  await fillPuzzle(page);
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("player-mobile.png"),
    fullPage: true,
  });
  await page.goto("/learn/sponsor-demo");
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Lesson title", { exact: true })
    .fill("A considerably longer campaign title for a narrow phone display");
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("sponsor-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Reward terms" }).click();
  await page.getByLabel("Reward cap", { exact: true }).fill("100000");
  await expect(page.getByText("10000 USDC", { exact: true })).toBeVisible();
  await noOverflow(page);
});
