import React from "react";
import { ThemeProvider } from "styled-components";
import { useTheme } from "next-themes";
import Crossword from "@crosswordxyz/react-crossword";

const lightCrosswordTheme = {
  columnBreakpoint: "768px",
  gridBackground: "#ffffff",
  cellBackground: "#e8ecf8",
  cellBorder: "#c7ceeb",
  textColor: "#1a1d2e",
  numberColor: "#4b5675",
  focusBackground: "#818cf8",
  highlightBackground: "#a5b4fc",
};

const darkCrosswordTheme = {
  columnBreakpoint: "768px",
  gridBackground: "#161a2e",
  cellBackground: "#1e2340",
  cellBorder: "#272d45",
  textColor: "#eef0f6",
  numberColor: "#6b7394",
  focusBackground: "#6366f1",
  highlightBackground: "#312e81",
};

const CrosswordPage = ({ data, onCrosswordComplete }) => {
  const { resolvedTheme } = useTheme();
  const crosswordTheme =
    resolvedTheme === "dark" ? darkCrosswordTheme : lightCrosswordTheme;

  return (
    <section className="card crossword-card">
      <div className="section-header">
        <p className="eyebrow">Live Puzzle</p>
        <h2>Solve and claim {data.reward} NEAR</h2>
      </div>

      <ThemeProvider theme={crosswordTheme}>
        <Crossword data={data} onCrosswordComplete={onCrosswordComplete} />
      </ThemeProvider>
    </section>
  );
};

export default CrosswordPage;
