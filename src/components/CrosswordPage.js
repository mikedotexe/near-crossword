import React from "react";
import { ThemeProvider } from "styled-components";
import Crossword from "@crosswordxyz/react-crossword";

const CrosswordPage = ({ data, onCrosswordComplete }) => {
  return (
    <section className="card crossword-card">
      <div className="section-header">
        <p className="eyebrow">Live Puzzle</p>
        <h2>Solve and claim {data.reward} NEAR</h2>
      </div>

      <ThemeProvider
        theme={{
          columnBreakpoint: "9999px",
          gridBackground: "#ffffff",
          cellBackground: "#dbe8ff",
          cellBorder: "#b9ccfb",
          textColor: "#1e293b",
          numberColor: "#1e293b",
          focusBackground: "#60a5fa",
          highlightBackground: "#93c5fd",
        }}
      >
        <Crossword data={data} onCrosswordComplete={onCrosswordComplete} />
      </ThemeProvider>
    </section>
  );
};

export default CrosswordPage;
