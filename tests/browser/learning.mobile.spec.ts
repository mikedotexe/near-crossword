import { expect, test } from "@playwright/test";
import { fillPuzzle, noOverflow } from "./learning.fixture";

test("phone practice board and private studio fit without page overflow", async ({
  page,
}, info) => {
  await page.goto("/learn/preview");
  await fillPuzzle(page);
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("player-mobile.png"),
    fullPage: true,
  });
  await page.goto("/learn/studio/preview");
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
