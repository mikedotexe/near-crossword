import { generateLayout } from "crossword-layout-generator";
import { parseSeedPhrase } from "near-seed-phrase";
import type { CluePair, LayoutAnswer, PuzzleResult } from "./types.js";

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
