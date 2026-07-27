import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicPuzzle } from "./validation";

function puzzle(direction: "across" | "down", length: number) {
  return {
    width: 4,
    height: 4,
    clues: [
      {
        number: 1,
        clue: "A valid clue",
        row: 2,
        column: 2,
        direction,
        length,
      },
      {
        number: 2,
        clue: "Another valid clue",
        row: 0,
        column: 0,
        direction: "across",
        length: 2,
      },
    ],
  };
}

describe("public puzzle geometry", () => {
  it("accepts clues whose final cell stays inside the grid", () => {
    assert.equal(publicPuzzle(puzzle("across", 2)).clues[0].length, 2);
    assert.equal(publicPuzzle(puzzle("down", 2)).clues[0].length, 2);
  });

  it("rejects clues that extend beyond the right or bottom edge", () => {
    assert.throws(() => publicPuzzle(puzzle("across", 3)), /extends beyond/);
    assert.throws(() => publicPuzzle(puzzle("down", 3)), /extends beyond/);
  });
});
