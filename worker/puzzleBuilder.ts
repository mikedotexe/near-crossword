import { generateLayout } from "crossword-layout-generator";
import { parseSeedPhrase } from "near-seed-phrase";
import type { CluePair, GridDimensions, LayoutAnswer, PuzzleResult } from "./types.js";

function deriveSeedPhrase(mungedLayout: { across: Record<string, any>; down: Record<string, any> }): string {
  const allNums = Object.keys(mungedLayout.across)
    .concat(Object.keys(mungedLayout.down))
    .map((n) => parseInt(n, 10));
  const totalClues = Math.max(...allNums);

  const seedWords: string[] = [];
  for (let i = 1; i <= totalClues; i++) {
    const iStr = i.toString();
    if (Object.prototype.hasOwnProperty.call(mungedLayout.across, iStr)) {
      seedWords.push(mungedLayout.across[i].answer);
    }
    if (Object.prototype.hasOwnProperty.call(mungedLayout.down, iStr)) {
      seedWords.push(mungedLayout.down[i].answer);
    }
  }

  return seedWords.map((w) => w.toLowerCase()).join(" ");
}

function mungeLayout(answers: LayoutAnswer[]): { across: Record<string, any>; down: Record<string, any> } {
  const data: { across: Record<string, any>; down: Record<string, any> } = { across: {}, down: {} };
  for (const clue of answers) {
    const dir = clue.direction.toLowerCase() as "across" | "down";
    data[dir][clue.num] = {
      clue: clue.clue,
      answer: clue.answer,
      row: clue.start.y,
      col: clue.start.x,
    };
  }
  return data;
}

export function buildPuzzle(clueAnswerPairs: CluePair[]): PuzzleResult {
  const layout = generateLayout(clueAnswerPairs);

  const answers: LayoutAnswer[] = [];
  for (const item of layout.result) {
    if (!item.position) continue;
    answers.push({
      num: item.position,
      start: { x: item.startx, y: item.starty },
      direction: item.orientation, // "across" or "down"
      length: item.answer.length,
      answer: item.answer,
      clue: item.clue,
    });
  }

  const dimensions = { x: layout.cols, y: layout.rows };
  const munged = mungeLayout(answers);
  const seedPhrase = deriveSeedPhrase(munged);
  const { publicKey } = parseSeedPhrase(seedPhrase);

  // Strip answer text and capitalize direction for the contract
  const contractAnswers = answers.map(({ answer, direction, ...rest }) => ({
    ...rest,
    direction: (direction === "down" ? "Down" : "Across") as "Across" | "Down",
  }));

  return {
    answers,
    contractAnswers,
    dimensions,
    answerPk: publicKey,
    seedPhrase,
  };
}

export function renderAsciiPreview(answers: LayoutAnswer[], dims: GridDimensions): string {
  // Build a 2D grid (1-indexed positions from layout generator)
  const grid: string[][] = [];
  for (let row = 0; row < dims.y; row++) {
    grid[row] = new Array(dims.x).fill("·");
  }

  for (const a of answers) {
    const dx = a.direction === "across" ? 1 : 0;
    const dy = a.direction === "down" ? 1 : 0;
    for (let i = 0; i < a.answer.length; i++) {
      const x = a.start.x - 1 + dx * i;
      const y = a.start.y - 1 + dy * i;
      grid[y][x] = a.answer[i].toUpperCase();
    }
  }

  const gridStr = grid.map((row) => row.join(" ")).join("\n");

  // Build clue lists grouped by direction
  const across = answers
    .filter((a) => a.direction === "across")
    .sort((a, b) => a.num - b.num);
  const down = answers
    .filter((a) => a.direction === "down")
    .sort((a, b) => a.num - b.num);

  let clues = "";
  if (across.length) {
    clues += "\n\n**Across**\n";
    clues += across.map((a) => `${a.num}. ${a.clue} → ${a.answer.toUpperCase()} (${a.length})`).join("\n");
  }
  if (down.length) {
    clues += "\n\n**Down**\n";
    clues += down.map((a) => `${a.num}. ${a.clue} → ${a.answer.toUpperCase()} (${a.length})`).join("\n");
  }

  return `**${dims.x} x ${dims.y} grid — ${answers.length} words**\n\n${gridStr}${clues}`;
}

export function renderSanitizedPreview(answers: LayoutAnswer[], dims: GridDimensions): string {
  // Build a 2D grid with blocks instead of letters
  const grid: string[][] = [];
  for (let row = 0; row < dims.y; row++) {
    grid[row] = new Array(dims.x).fill("·");
  }

  for (const a of answers) {
    const dx = a.direction === "across" ? 1 : 0;
    const dy = a.direction === "down" ? 1 : 0;
    for (let i = 0; i < a.answer.length; i++) {
      const x = a.start.x - 1 + dx * i;
      const y = a.start.y - 1 + dy * i;
      grid[y][x] = "█";
    }
  }

  const gridStr = grid.map((row) => row.join(" ")).join("\n");

  // Clues without answers
  const across = answers
    .filter((a) => a.direction === "across")
    .sort((a, b) => a.num - b.num);
  const down = answers
    .filter((a) => a.direction === "down")
    .sort((a, b) => a.num - b.num);

  let clues = "";
  if (across.length) {
    clues += "\n\n**Across**\n";
    clues += across.map((a) => `${a.num}. ${a.clue} (${a.length} letters)`).join("\n");
  }
  if (down.length) {
    clues += "\n\n**Down**\n";
    clues += down.map((a) => `${a.num}. ${a.clue} (${a.length} letters)`).join("\n");
  }

  return `**${dims.x} x ${dims.y} grid — ${answers.length} words**\n\n${gridStr}${clues}`;
}
