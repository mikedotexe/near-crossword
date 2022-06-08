import { ThemeProvider } from "styled-components";
import Crossword from "react-crossword/dist/es/Crossword";
import React from "react";

const CrosswordPage = ({ data, onCrosswordComplete }) => {
  // i get much joy imagining people who are particular about code quality
  // looking at this repo. the sheer disgust they'd experience would
  // delight me.
  const macroCosm = document.getElementById('macrocosm');
  const macroCosmAgainDude = document.getElementById('even-more-macro');
  let addClassName = "crossword-intro";
  macroCosm.classList.add(addClassName);
  macroCosmAgainDude.classList.add(addClassName);
  let removeClassName = "crossword-form";
  macroCosm.classList.remove(removeClassName);
  macroCosmAgainDude.classList.remove(removeClassName);
  removeClassName = "no-crosswords";
  macroCosm.classList.remove(removeClassName);
  macroCosmAgainDude.classList.remove(removeClassName);

  return (
    <div className="content">
      <div>
        <ThemeProvider
          theme={{
            columnBreakpoint: "9999px",
            gridBackground: "#fff",
            cellBackground: "#8ba9f9",
            cellBorder: "#dfe8fe",
            textColor: "#dae3ff",
            numberColor: "#000000",
            focusBackground: "#346af7",
            highlightBackground: "#779bfc",
            clueHighlightBackground: "rgba(119,155,252,0.5)"
          }}
        >
          <Crossword data={data} onCrosswordComplete={onCrosswordComplete} />
        </ThemeProvider>
        <div className="bottom"></div>
      </div>
    </div>
  );
};

export default CrosswordPage;
