import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";
import { keccak256, stringToHex } from "viem";
import { z } from "zod";
import { entryCells, type LearningLayout } from "../../lib/base/learning";
import { AppError } from "../v2/errors";

const coordinate = z.number().int().min(0).max(23);
const schema = z
  .object({
    version: z.literal("crossword-layout:v1"),
    rows: z.number().int().min(3).max(24),
    columns: z.number().int().min(3).max(24),
    entries: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(11),
            number: z.number().int().positive().max(12),
            row: coordinate,
            column: coordinate,
            direction: z.enum(["across", "down"]),
            length: z.number().int().min(3).max(24),
          })
          .strict(),
      )
      .min(3)
      .max(12),
  })
  .strict();

function invalid(): never {
  throw new AppError(
    409,
    "LAYOUT_REVIEW_REQUIRED",
    "These answers need a connected crossword layout; revise the entries and review again",
  );
}

export function validateLayout(
  raw: unknown,
  answers: string[],
): LearningLayout {
  const result = schema.safeParse(raw);
  if (
    !result.success ||
    result.data.entries.length !== answers.length ||
    answers.some((a) => !/^[A-Z]{3,24}$/.test(a))
  )
    invalid();
  const layout = result.data;
  const cells = new Map<number, { letter: string; owners: number[] }>();
  const starts = [
    ...new Set(layout.entries.map((e) => e.row * layout.columns + e.column)),
  ].sort((a, b) => a - b);
  for (const [index, entry] of layout.entries.entries()) {
    if (
      entry.index !== index ||
      answers[index].length !== entry.length ||
      entry.number !==
        starts.indexOf(entry.row * layout.columns + entry.column) + 1 ||
      entry.row + (entry.direction === "down" ? entry.length : 1) >
        layout.rows ||
      entry.column + (entry.direction === "across" ? entry.length : 1) >
        layout.columns
    )
      invalid();
    entryCells(entry, layout.columns).forEach((cell, offset) => {
      const prior = cells.get(cell);
      if (
        prior &&
        (prior.letter !== answers[index][offset] ||
          prior.owners.some(
            (i) => layout.entries[i].direction === entry.direction,
          ))
      )
        invalid();
      cells.set(cell, {
        letter: answers[index][offset],
        owners: [...(prior?.owners || []), index],
      });
    });
  }
  // Every contiguous run must be a declared word, including incidental adjacent runs.
  for (const cell of cells.keys()) {
    const row = Math.floor(cell / layout.columns),
      column = cell % layout.columns;
    for (const direction of ["across", "down"] as const) {
      const step = direction === "across" ? 1 : layout.columns;
      if (
        (direction === "across" ? column > 0 : row > 0) &&
        cells.has(cell - step)
      )
        continue;
      let length = 1;
      while (
        (direction === "across"
          ? column + length < layout.columns
          : row + length < layout.rows) &&
        cells.has(cell + length * step)
      )
        length++;
      if (
        length > 1 &&
        !layout.entries.some(
          (e) =>
            e.row === row &&
            e.column === column &&
            e.direction === direction &&
            e.length === length,
        )
      )
        invalid();
    }
  }
  const connected = new Set([0]);
  for (let pass = 0; pass < answers.length; pass++) {
    for (const cell of cells.values())
      if (cell.owners.some((i) => connected.has(i)))
        cell.owners.forEach((i) => connected.add(i));
  }
  if (connected.size !== answers.length) invalid();
  return layout;
}

let generator: Script | undefined;
export function generateLayout(answers: string[]): LearningLayout {
  if (
    answers.length < 3 ||
    answers.length > 12 ||
    answers.some((a) => !/^[A-Z]{3,24}$/.test(a))
  )
    invalid();
  try {
    // This pinned library prints answers. A separate console and CPU-bounded context
    // prevent private material reaching process logs; never replace global console.
    generator ??= new Script(
      readFileSync(join(process.cwd(), "node_modules/crossword-layout-generator/src/layout_generator.js"), "utf8") +
        "\nmodule.exports.generateLayout(input);",
    );
  } catch {
    throw new AppError(503, "LAYOUT_ENGINE_UNAVAILABLE", "The crossword layout engine is unavailable");
  }
  try {
    const generated = generator.runInNewContext(
      {
        module: { exports: {} },
        console: Object.freeze({ log() {} }),
        input: answers.map((answer, index) => ({ answer, index })),
      },
      { timeout: 1000 },
    ) as {
      rows: number;
      cols: number;
      result: Array<{
        index: number;
        startx: number;
        starty: number;
        orientation: string;
      }>;
    };
    const entries = [...generated.result]
      .sort((a, b) => a.index - b.index)
      .map((e) => ({
        index: e.index,
        number: 0,
        row: e.starty - 1,
        column: e.startx - 1,
        direction: e.orientation,
        length: answers[e.index].length,
      }));
    const starts = [
      ...new Set(entries.map((e) => e.row * generated.cols + e.column)),
    ].sort((a, b) => a - b);
    entries.forEach((e) => {
      e.number = starts.indexOf(e.row * generated.cols + e.column) + 1;
    });
    return validateLayout(
      {
        version: "crossword-layout:v1",
        rows: generated.rows,
        columns: generated.cols,
        entries,
      },
      answers,
    );
  } catch {
    return invalid();
  }
}

export function layoutHash(layout: LearningLayout) {
  return keccak256(stringToHex(JSON.stringify(layout)));
}
export function publicationHash(
  id: string,
  revision: number,
  termsHash: string,
  hash: string,
) {
  return keccak256(
    stringToHex(
      JSON.stringify({
        version: "learning-publication:v1",
        campaignId: id,
        revision,
        termsHash,
        layoutHash: hash,
      }),
    ),
  );
}
