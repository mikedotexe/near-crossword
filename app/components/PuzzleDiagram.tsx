import { getPuzzleCells } from "../lib/puzzle";
import type { PuzzleDefinition } from "../lib/types";

export function PuzzleDiagram({
  puzzle,
  values,
  compact = false,
  labelledBy,
  maxCellSizeRem,
}: {
  puzzle: PuzzleDefinition;
  values?: Record<string, string>;
  compact?: boolean;
  labelledBy?: string;
  maxCellSizeRem?: number;
}) {
  const cells = getPuzzleCells(puzzle);
  const maxDimension = Math.max(puzzle.rows, puzzle.columns);
  const maxSize = maxCellSizeRem ?? (compact ? 2 : 2.7);
  const cellSize = `min(${maxSize}rem, calc((100vw - ${compact ? 5 : 4}rem) / ${maxDimension}))`;

  return (
    <div
      className={`puzzle-diagram${compact ? " puzzle-diagram--compact" : ""}`}
      role="img"
      aria-labelledby={labelledBy}
      style={{
        gridTemplateColumns: `repeat(${puzzle.columns}, ${cellSize})`,
        gridTemplateRows: `repeat(${puzzle.rows}, ${cellSize})`,
      }}
    >
      {Array.from({ length: puzzle.rows * puzzle.columns }).map((_, index) => {
        const row = Math.floor(index / puzzle.columns);
        const column = index % puzzle.columns;
        const key = `${row}:${column}`;
        const cell = cells.get(key);

        if (!cell) {
          return <span className="puzzle-diagram__void" key={key} />;
        }

        return (
          <span className="puzzle-diagram__cell" key={key}>
            {cell.number ? (
              <small aria-hidden="true">{cell.number}</small>
            ) : null}
            {values?.[key] ? (
              <b aria-hidden="true">{values[key].toUpperCase()}</b>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
