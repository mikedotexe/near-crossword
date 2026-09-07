import { expect, type Page } from "@playwright/test";
import { reviewFixture } from "../../src/server/base/workflow.fixture";
import { reviewMaterial } from "../../src/server/base/review";
import {
  generateLayout,
  layoutHash,
  publicationHash,
} from "../../src/server/base/layout";
import { baseNativeUsdc } from "../../src/lib/base/escrow-abi";
import { entryCells, type PublicLesson } from "../../src/lib/base/learning";

export const id = "a39a1000-e30f-4a40-8e11-7bb8e2eb4001";
const input = reviewFixture();
export const material = reviewMaterial(
  {
    ...input,
    terms: { ...input.terms, chainId: 84532, token: baseNativeUsdc[84532] },
  },
  1,
  id,
);
export const layout = generateLayout(
  material.submission.draft.entries.map((e) => e.answer),
);
export const layoutReview = {
  revision: 1,
  termsHash: material.termsHash,
  layoutHash: layoutHash(layout),
  publicationHash: publicationHash(
    id,
    1,
    material.termsHash,
    layoutHash(layout),
  ),
  layout,
  approved: false,
  published: false,
};
export const lesson: PublicLesson = {
  id,
  revision: 1,
  ...material.publicContent,
  terms: material.submission.terms,
  layout,
  termsHash: material.termsHash,
  layoutHash: layoutReview.layoutHash,
  publicationHash: layoutReview.publicationHash,
  publishedAt: new Date().toISOString(),
  onChainId: "1",
  availability: "OPEN",
  remainingSlots: 3,
  paidCount: 0,
  asOf: { blockNumber: "12345", blockHash: `0x${"ab".repeat(32)}` },
};

export async function fillPuzzle(page: Page) {
  const letters = new Map<number, string>();
  for (const entry of layout.entries)
    entryCells(entry, layout.columns).forEach((cell, offset) =>
      letters.set(
        cell,
        material.submission.draft.entries[entry.index].answer[offset],
      ),
    );
  for (const [cell, letter] of letters)
    await page
      .getByLabel(
        `Row ${Math.floor(cell / layout.columns) + 1}, column ${(cell % layout.columns) + 1}`,
        { exact: true },
      )
      .fill(letter);
}

export async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const inputs = await page
    .locator(".learn-cell input")
    .evaluateAll((elements) =>
      elements.map((e) => {
        const box = e.getBoundingClientRect();
        return box.width > 20 && box.height > 20;
      }),
    );
  expect(inputs.every(Boolean)).toBe(true);
}
