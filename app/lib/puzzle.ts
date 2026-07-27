import type { PuzzleDefinition, PuzzleEntry } from "./types";

export interface DraftEntry {
  clue: string;
  answer: string;
}

interface PositionedDraft extends DraftEntry {
  number: number;
  row: number;
  column: number;
  direction: "across" | "down";
}

const cleanAnswer = (answer: string) =>
  answer.toUpperCase().replace(/[^A-Z0-9]/g, "");

function intersects(
  placed: PositionedDraft[],
  answer: string,
  row: number,
  column: number,
  direction: "across" | "down",
): boolean {
  const cells = new Map<string, string>();

  for (const item of placed) {
    const word = cleanAnswer(item.answer);
    for (let index = 0; index < word.length; index += 1) {
      const cellRow = item.row + (item.direction === "down" ? index : 0);
      const cellColumn = item.column + (item.direction === "across" ? index : 0);
      cells.set(`${cellRow}:${cellColumn}`, word[index]);
    }
  }

  for (let index = 0; index < answer.length; index += 1) {
    const cellRow = row + (direction === "down" ? index : 0);
    const cellColumn = column + (direction === "across" ? index : 0);
    const existing = cells.get(`${cellRow}:${cellColumn}`);
    if (existing && existing !== answer[index]) return false;
  }

  return true;
}

/**
 * A small deterministic layout helper for the creator preview. It favors a
 * central spine and real character intersections, then falls back to tidy
 * parallel rows. The published API stores normalized zero-based coordinates.
 */
export function layoutDraft(entries: DraftEntry[]): {
  puzzle: PuzzleDefinition;
  positioned: PositionedDraft[];
} {
  const valid = entries
    .map((entry) => ({ ...entry, answer: cleanAnswer(entry.answer) }))
    .filter((entry) => entry.clue.trim().length > 2 && entry.answer.length > 2)
    .slice(0, 12);

  if (!valid.length) {
    return {
      puzzle: { rows: 5, columns: 5, entries: [] },
      positioned: [],
    };
  }

  const placed: PositionedDraft[] = [
    {
      ...valid[0],
      number: 1,
      row: 0,
      column: 0,
      direction: "across",
    },
  ];

  for (let itemIndex = 1; itemIndex < valid.length; itemIndex += 1) {
    const item = valid[itemIndex];
    let candidate: PositionedDraft | null = null;

    for (const anchor of placed) {
      const anchorWord = cleanAnswer(anchor.answer);
      for (
        let anchorIndex = 0;
        anchorIndex < anchorWord.length && !candidate;
        anchorIndex += 1
      ) {
        for (
          let itemLetter = 0;
          itemLetter < item.answer.length && !candidate;
          itemLetter += 1
        ) {
          if (anchorWord[anchorIndex] !== item.answer[itemLetter]) continue;
          const direction = anchor.direction === "across" ? "down" : "across";
          const crossRow =
            anchor.row + (anchor.direction === "down" ? anchorIndex : 0);
          const crossColumn =
            anchor.column + (anchor.direction === "across" ? anchorIndex : 0);
          const row = crossRow - (direction === "down" ? itemLetter : 0);
          const column = crossColumn - (direction === "across" ? itemLetter : 0);
          if (row < 0 || column < 0) continue;
          if (!intersects(placed, item.answer, row, column, direction)) continue;
          candidate = {
            ...item,
            number: itemIndex + 1,
            row,
            column,
            direction,
          };
        }
      }
      if (candidate) break;
    }

    placed.push(
      candidate ?? {
        ...item,
        number: itemIndex + 1,
        row: placed.reduce(
          (max, positioned) =>
            Math.max(
              max,
              positioned.row +
                (positioned.direction === "down"
                  ? cleanAnswer(positioned.answer).length
                  : 1),
            ),
          0,
        ),
        column: 0,
        direction: "across",
      },
    );
  }

  const rows = Math.max(
    5,
    ...placed.map(
      (entry) =>
        entry.row +
        (entry.direction === "down" ? cleanAnswer(entry.answer).length : 1),
    ),
  );
  const columns = Math.max(
    5,
    ...placed.map(
      (entry) =>
        entry.column +
        (entry.direction === "across" ? cleanAnswer(entry.answer).length : 1),
    ),
  );

  const normalizedEntries: PuzzleEntry[] = placed.map((entry) => ({
    number: entry.number,
    row: entry.row,
    column: entry.column,
    length: cleanAnswer(entry.answer).length,
    direction: entry.direction,
    clue: entry.clue.trim(),
  }));

  return {
    puzzle: { rows, columns, entries: normalizedEntries },
    positioned: placed,
  };
}

export function getPuzzleCells(puzzle: PuzzleDefinition) {
  const cells = new Map<
    string,
    { row: number; column: number; number?: number }
  >();

  for (const entry of puzzle.entries) {
    for (let index = 0; index < entry.length; index += 1) {
      const row = entry.row + (entry.direction === "down" ? index : 0);
      const column = entry.column + (entry.direction === "across" ? index : 0);
      const key = `${row}:${column}`;
      const existing = cells.get(key);
      cells.set(key, {
        row,
        column,
        number:
          index === 0
            ? Math.min(existing?.number ?? entry.number, entry.number)
            : existing?.number,
      });
    }
  }

  return cells;
}

export function canonicalAnswers(
  puzzle: PuzzleDefinition,
  guesses: Record<string, string>,
): string {
  return [...puzzle.entries]
    .sort((left, right) =>
      left.number === right.number
        ? left.direction.localeCompare(right.direction)
        : left.number - right.number,
    )
    .map((entry) => {
      let answer = "";
      for (let index = 0; index < entry.length; index += 1) {
        const row = entry.row + (entry.direction === "down" ? index : 0);
        const column = entry.column + (entry.direction === "across" ? index : 0);
        answer += guesses[`${row}:${column}`] ?? "";
      }
      return answer.toLowerCase();
    })
    .join(" ");
}
