import "regenerator-runtime/runtime";
import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import getConfig from './config.js';
import { mungeBlockchainCrossword, viewMethodOnContract } from './utils';
import { generateSeedPhrase } from 'near-seed-phrase';

async function initCrossword() {
  const nearConfig = getConfig(process.env.NEAR_ENV || 'testnet');

  let existingKey = localStorage.getItem('playerKeyPair');

  if (!existingKey) {
    // Create a random key in here
    let seedPhrase = generateSeedPhrase();
    localStorage.setItem('playerKeyPair', JSON.stringify(seedPhrase));
  }

  // Get crossword puzzle using view method
  const chainData = await viewMethodOnContract(nearConfig, 'get_unsolved_puzzles');
  let data;

  // There may not be any crossword puzzles to solve, check this.
  if (chainData.puzzles.length) {
    // Save the crossword solution's public key
    // Again, assuming there's only one crossword puzzle.
    localStorage.setItem('crosswordSolutionPublicKey', chainData.puzzles[0]['solution_public_key']);
    data = mungeBlockchainCrossword(chainData.puzzles);
  } else {
    console.log("Oof, there's no crossword to play right now, friend.");
  }
  let creatorAccount = chainData.creator_account;

  return { nearConfig, data, creatorAccount };
}

window.nearInitPromise = initCrossword()
  .then(({ nearConfig, data, creatorAccount }) => {
    if (!process.env.CONTRACT_NAME) {
      console.error('Could not find the CONTRACT_NAME environment variable, please set it. Love, Mike.')
    }
    if (!process.env.NEAR_ENV) {
      console.error('Could not find the NEAR_ENV environment variable, please set it. Love, Mike.')
    }
    const maxNum = 19;
    const cronMe = async (num) => {
      setTimeout(async () => {
        const macroCosm = document.getElementById('macrocosm');
        const macroCosmAgainDude = document.getElementById('even-more-macro');
        let a, r;
        const onIntroPage = Array.from(macroCosm.classList).includes('crossword-intro');
        const onCreateCrossword = Array.from(macroCosm.classList).includes('crossword-form');
        const onNoCrosswords = Array.from(macroCosm.classList).includes('no-crosswords');
        switch (num) {
          case 1:
            if (onIntroPage) {
              a = "zoom-out";
              macroCosm.classList.add(a);
            }
            break;
          case 2:
            if (onIntroPage) {
              a = "zoom-out-done";
              macroCosm.classList.add(a);
              r = "zoom-out"
              macroCosm.classList.remove(r);
            }
            break;
          case 3:
            if (onIntroPage) {
              a = "zoom-in";
              macroCosm.classList.add(a);
            }
            break;
          case 4:
            if (onIntroPage) {
              a = "zoom-in-done";
              macroCosm.classList.add(a);
              a = "logo-bye";
              macroCosm.classList.add(a);
              r = "zoom-in";
              macroCosm.classList.remove(r);
            }
            break;
          case 5:
            if (onIntroPage) {
              a = "it-shrinks";
              macroCosm.classList.add(a);
              r = "logo-bye";
              macroCosm.classList.remove(r);
            }
            break;
          case 6:
            if (onIntroPage) {
              a = "it-shrinks-done";
              macroCosm.classList.add(a);
              a = "rezoom";
              macroCosm.classList.add(a);
              r = "it-shrinks";
              macroCosm.classList.remove(r);
            }
            break;
          case 7:
            if (onIntroPage) {
              a = "rezoom-done";
              macroCosm.classList.add(a);
              a = "grid-scaling";
              macroCosm.classList.add(a);
              r = "rezoom";
              macroCosm.classList.remove(r);
            }
              break;
          case 8:
            if (onIntroPage) {
              // Turn on the animations for the hands
              a = "grid-scaling-done";
              macroCosm.classList.add(a);
              a = "new-thing";
              macroCosm.classList.add(a);
              r = "grid-scaling";
              macroCosm.classList.remove(r);
            }
            break;
          case 9:
            break;
          case 10:
            break;
          case 11:
            break;
          case 12:
            break;
          case 13:
            if (onIntroPage) {
              a = "new-thing-done";
              macroCosm.classList.add(a);
              a = "im-so-tired";
              macroCosm.classList.add(a);
              r = "new-thing";
              macroCosm.classList.remove(r);
            }
            break;
          default:
            return;
        }
        macroCosmAgainDude.className = macroCosm.className;
        if (num < maxNum) {
          cronMe(num + 1)
        }
      }, 600);
    }
    cronMe(1)
    let contractName = process.env.CONTRACT_NAME;
    ReactDOM.render(
      <>
        <App
          nearConfig={nearConfig}
          data={data}
          contractName={contractName}
          creatorAccount={creatorAccount} // not sure if we need this
        />
      </>,
      document.getElementById('root'));
  });
