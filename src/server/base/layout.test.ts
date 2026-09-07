import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateLayout,
  layoutHash,
  publicationHash,
  validateLayout,
} from "./layout";

const answers = ["WALLET", "LEDGER", "TRANSFER"];
test("pinned generator creates deterministic, connected, answer-free layout with conventional numbering", () => {
  const a = generateLayout(answers),
    b = generateLayout(answers);
  assert.deepEqual(a, b);
  assert.deepEqual(
    a.entries.map((e) => e.number),
    [2, 1, 3],
  );
  assert.equal(layoutHash(a), layoutHash(b));
  assert.equal(validateLayout(JSON.parse(JSON.stringify(a)), answers).rows, 7);
  assert.doesNotMatch(
    JSON.stringify(a),
    /WALLET|LEDGER|TRANSFER|answer|table_string/,
  );
  assert.notEqual(
    publicationHash("campaign", 1, "terms", layoutHash(a)),
    publicationHash("campaign", 2, "terms", layoutHash(a)),
  );
});
test("layout refuses unplaced words, bad bounds, added data, mismatched crossings and duplicate entries", () => {
  assert.throws(() => generateLayout(["AAA", "BBB", "CCC"]), {
    code: "LAYOUT_REVIEW_REQUIRED",
  });
  const layout = generateLayout(answers);
  for (const mutate of [
    (l: typeof layout) => {
      l.entries[0].row = 24;
    },
    (l: typeof layout) => {
      l.entries[0].length = 7;
    },
    (l: typeof layout) => {
      l.entries[1].index = 0;
    },
    (l: typeof layout) => {
      l.entries[0].number = 1;
    },
    (l: typeof layout) => {
      l.entries.pop();
    },
  ]) {
    const copy = structuredClone(layout);
    mutate(copy);
    assert.throws(() => validateLayout(copy, answers));
  }
  assert.throws(() => validateLayout({ ...layout, answers }, answers));
  assert.throws(() => validateLayout(layout, ["XXXXXX", "LEDGER", "TRANSFER"]));
});
