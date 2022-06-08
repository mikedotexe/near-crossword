import React from "react";

const NoCrosswordsPage = () => {
  const macroCosm = document.getElementById('macrocosm');
  const macroCosmAgainDude = document.getElementById('even-more-macro');
  let addClassName = "no-crosswords";
  macroCosm.classList.add(addClassName);
  macroCosmAgainDude.classList.add(addClassName);
  let removeClassName = "crossword-intro"
  macroCosm.classList.remove(removeClassName);
  macroCosmAgainDude.classList.remove(removeClassName);
  removeClassName = "crossword-form"
  macroCosm.classList.remove(removeClassName);
  macroCosmAgainDude.classList.remove(removeClassName);

  return (
    <div className="container no-puzzles">
      <div className="successful-page-title">All puzzles have been solved</div>

      <div className="successful-text">
        Sorry friend, no crossword puzzles available at this time.
      </div>
      <div className="successful-text">
        In the meantime, check out these links:
      </div>
      <div className={"moral-ads"}></div>
      <div className="arrows" />
      <div className="success-links">
        <div className="success-link">
          <div className="bridge-text">For developers</div>
          <div className="btn">
            <a href="https://examples.near.org" target="_blank">NEAR Examples</a>
          </div>
        </div>
        <div className="success-link">
          <div className="bridge-text">DeFi, NFTs, games, comics, etc. </div>
          <div className="btn">
            <a
              href="https://awesomenear.com?from=crossword"
              // className="near-link"
              target="_blank"
            >
              Awesome NEAR projects
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
export default NoCrosswordsPage;
