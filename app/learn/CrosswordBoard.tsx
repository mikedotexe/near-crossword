"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowRight, RotateCcw } from "lucide-react";
import { entryCells, type LearningLayout } from "../../src/lib/base/learning";

export function CrosswordBoard({
  layout,
  clues,
  letters,
  onChange,
  readOnly = false,
}: {
  layout: LearningLayout;
  clues: Array<{ clue: string; length: number }>;
  letters: string[];
  onChange: (letters: string[]) => void;
  readOnly?: boolean;
}) {
  const [active, setActive] = useState(0);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const activeEntry = layout.entries[active] || layout.entries[0];
  const selected = entryCells(activeEntry, layout.columns);
  const occupied = new Set(
    layout.entries.flatMap((entry) => entryCells(entry, layout.columns)),
  );
  const numbers = new Map(
    layout.entries.map((entry) => [
      entry.row * layout.columns + entry.column,
      entry.number,
    ]),
  );
  function choose(index: number) {
    setActive(index);
    const cells = entryCells(layout.entries[index], layout.columns);
    inputs.current[cells.find((cell) => !letters[cell]) ?? cells[0]]?.focus();
  }
  function change(cell: number, value: string) {
    const next = [...letters];
    next[cell] = value
      .replace(/[^a-z]/gi, "")
      .slice(-1)
      .toUpperCase();
    onChange(next);
    if (next[cell])
      inputs.current[
        selected[Math.min(selected.indexOf(cell) + 1, selected.length - 1)]
      ]?.focus();
  }
  return (
    <div className="learn-puzzle">
      <div className="learn-toolbar">
        <span>
          {activeEntry.number}{" "}
          {activeEntry.direction === "across" ? (
            <ArrowRight size={16} aria-label="Across" />
          ) : (
            <ArrowDown size={16} aria-label="Down" />
          )}{" "}
          {clues[activeEntry.index].clue}
        </span>
        {!readOnly && (
          <button
            className="learn-icon"
            type="button"
            title="Clear puzzle"
            aria-label="Clear puzzle"
            onClick={() =>
              onChange(Array(layout.rows * layout.columns).fill(""))
            }
          >
            <RotateCcw size={18} />
          </button>
        )}
      </div>
      <div className="learn-board-scroll">
        <div
          className="learn-board"
          role="group"
          aria-label="Crossword"
          style={{
            gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
            aspectRatio: `${layout.columns}/${layout.rows}`,
            minWidth: layout.columns * 24,
          }}
        >
          {Array.from({ length: layout.rows * layout.columns }, (_, cell) =>
            occupied.has(cell) ? (
              <label
                key={cell}
                className={`learn-cell${selected.includes(cell) ? " is-selected" : ""}`}
              >
                <span aria-hidden="true">{numbers.get(cell)}</span>
                <input
                  ref={(element) => {
                    inputs.current[cell] = element;
                  }}
                  aria-label={`Row ${Math.floor(cell / layout.columns) + 1}, column ${(cell % layout.columns) + 1}`}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={1}
                  value={letters[cell] || ""}
                  readOnly={readOnly}
                  onFocus={() => {
                    if (!selected.includes(cell))
                      setActive(
                        layout.entries.findIndex((e) =>
                          entryCells(e, layout.columns).includes(cell),
                        ),
                      );
                  }}
                  onClick={() => inputs.current[cell]?.select()}
                  onChange={(event) => change(cell, event.target.value)}
                  onKeyDown={(event) => {
                    const delta = {
                      ArrowLeft: -1,
                      ArrowRight: 1,
                      ArrowUp: -layout.columns,
                      ArrowDown: layout.columns,
                    }[event.key];
                    if (delta !== undefined) {
                      event.preventDefault();
                      const next = cell + delta;
                      if (
                        Math.abs(delta) === 1 &&
                        Math.floor(next / layout.columns) !==
                          Math.floor(cell / layout.columns)
                      )
                        return;
                      inputs.current[next]?.focus();
                    } else if (
                      event.key === "Backspace" &&
                      !letters[cell] &&
                      !readOnly
                    ) {
                      event.preventDefault();
                      inputs.current[
                        selected[Math.max(0, selected.indexOf(cell) - 1)]
                      ]?.focus();
                    } else if (event.key === " " && !readOnly) {
                      event.preventDefault();
                      const alternative = layout.entries.findIndex(
                        (entry, index) =>
                          index !== active &&
                          entryCells(entry, layout.columns).includes(cell),
                      );
                      if (alternative >= 0) setActive(alternative);
                    }
                  }}
                />
              </label>
            ) : (
              <span className="learn-black" key={cell} aria-hidden="true" />
            ),
          )}
        </div>
      </div>
      <div className="learn-clues">
        {(["across", "down"] as const).map((direction) => (
          <section key={direction}>
            <h3>
              {direction === "across" ? (
                <ArrowRight size={16} />
              ) : (
                <ArrowDown size={16} />
              )}
              {direction === "across" ? "Across" : "Down"}
            </h3>
            {layout.entries
              .filter((entry) => entry.direction === direction)
              .sort((a, b) => a.number - b.number)
              .map((entry) => (
                <button
                  type="button"
                  key={entry.index}
                  aria-pressed={active === entry.index}
                  onClick={() => choose(entry.index)}
                >
                  <strong>{entry.number}</strong>
                  <span>
                    {clues[entry.index].clue} <small>({entry.length})</small>
                  </span>
                </button>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
