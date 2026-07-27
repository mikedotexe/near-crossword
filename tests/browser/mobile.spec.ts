import { expect, test } from "@playwright/test";

test("mobile solving progress survives reload without storing payment keys", async ({
  page,
}) => {
  await page.goto("/campaigns/open-web-jackpot/play");
  await expect(
    page.getByText(/Interactive product preview/i),
  ).toBeVisible();

  const grid = page.getByRole("group", {
    name: /Open Web Jackpot crossword grid/i,
  });
  const inputs = grid.locator("input");
  const count = await inputs.count();
  expect(count).toBeGreaterThan(10);

  await inputs.first().fill("A");
  await expect(page.getByText(/% complete/).first()).not.toHaveText(
    "0% complete",
  );
  await page.reload();
  await expect(inputs.first()).toHaveValue("A");

  const storage = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(window.localStorage).map((key) => [
        key,
        window.localStorage.getItem(key),
      ]),
    ),
  );
  expect(Object.keys(storage)).toEqual(["crossword:progress:demo-open-web"]);
  expect(JSON.stringify(storage)).not.toMatch(
    /private.?key|secret.?key|payment|signature/i,
  );

  for (let index = 0; index < count; index += 1) {
    await inputs.nth(index).fill("A");
  }
  await page.getByRole("button", { name: "Prepare prize claim" }).click();
  await page
    .getByRole("radio", { name: /Another asset or chain/i })
    .check();
  await page
    .getByLabel("Destination address")
    .fill("0x2222222222222222222222222222222222222222");
  await page.getByLabel("NEAR recovery account").fill("winner.testnet");
  await page.getByRole("button", { name: "Review payout quote" }).click();
  await expect(page.getByText(/Demo quote prepared/i)).toBeVisible();
  await page.getByRole("button", { name: /Sign proof & claim/i }).click();
  await expect(
    page.getByRole("heading", { name: "Preview complete" }),
  ).toBeVisible();
});
