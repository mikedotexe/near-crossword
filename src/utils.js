import { createRpcError } from "./lib/rpcError.js";

// This function takes the input from the Rust smart contract
// and turns it into what the crossword library would like.
// Opportunity to enhance the library so this isn't necessary.

function formatNearAmount(yoctoValue) {
  const valueText = String(yoctoValue).replace(/^0+/, "") || "0";
  const wholeText =
    valueText.length > 24 ? valueText.slice(0, valueText.length - 24) : "0";
  const fractionRaw =
    valueText.length > 24
      ? valueText.slice(valueText.length - 24)
      : valueText.padStart(24, "0");
  const fractionText = fractionRaw.replace(/0+$/, "");

  if (!fractionText) {
    return wholeText;
  }

  const shortenedFraction = fractionText.slice(0, 5).replace(/0+$/, "");
  return shortenedFraction
    ? `${wholeText}.${shortenedFraction}`
    : wholeText;
}

export function mungeBlockchainCrossword(chainData) {
  const rewardRaw = chainData[0].reward.toLocaleString("fullwide", {
    useGrouping: false,
  });

  const data = {
    across: {},
    down: {},
    reward: formatNearAmount(rewardRaw),
  };
  const crosswordClues = chainData[0].answer;

  crosswordClues.forEach((clue) => {
    const direction = clue.direction.toLowerCase();
    data[direction][clue.num] = {};
    data[direction][clue.num].clue = clue.clue;
    data[direction][clue.num].answer = "?".repeat(clue.length);
    data[direction][clue.num].row = clue.start.y;
    data[direction][clue.num].col = clue.start.x;
  });
  return data;
}

export function mungeLocalCrossword(answers) {
  const data = {
    across: {},
    down: {},
  };

  answers.forEach((clue) => {
    const direction = clue.direction.toLowerCase();
    data[direction][clue.num] = {};
    data[direction][clue.num].clue = clue.clue;
    data[direction][clue.num].answer = clue.answer;
    data[direction][clue.num].row = clue.start.y;
    data[direction][clue.num].col = clue.start.x;
  });
  return data;
}

export async function viewMethodOnContract(nearConfig, method) {
  let response;
  try {
    response = await fetch(nearConfig.nodeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "near-crossword",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: nearConfig.contractName,
          method_name: method,
          args_base64: "e30=",
        },
      }),
    });
  } catch (error) {
    throw createRpcError({
      message: "Network error while querying NEAR RPC.",
      isNetworkFailure: true,
      context: {
        networkId: nearConfig.networkId,
        contractName: nearConfig.contractName,
        method,
      },
      cause: error,
    });
  }

  if (!response.ok) {
    throw createRpcError({
      message: `RPC HTTP error (${response.status}) while querying ${method}.`,
      isNetworkFailure: true,
      context: {
        networkId: nearConfig.networkId,
        contractName: nearConfig.contractName,
        method,
      },
    });
  }

  let json;
  try {
    json = await response.json();
  } catch (error) {
    throw createRpcError({
      message: "Failed to parse RPC response.",
      context: {
        networkId: nearConfig.networkId,
        contractName: nearConfig.contractName,
        method,
      },
      cause: error,
    });
  }

  if (json.error) {
    throw createRpcError({
      rpcError: json.error,
      context: {
        networkId: nearConfig.networkId,
        contractName: nearConfig.contractName,
        method,
      },
    });
  }

  if (!Array.isArray(json.result?.result)) {
    throw createRpcError({
      message: "RPC response did not include function result bytes.",
      context: {
        networkId: nearConfig.networkId,
        contractName: nearConfig.contractName,
        method,
      },
    });
  }

  const decoded = json.result.result
    .map((charCode) => String.fromCharCode(charCode))
    .join("");
  try {
    return JSON.parse(decoded);
  } catch (error) {
    throw createRpcError({
      message: "Failed to parse contract method JSON output.",
      context: {
        networkId: nearConfig.networkId,
        contractName: nearConfig.contractName,
        method,
      },
      cause: error,
    });
  }
}

export function parseSolutionSeedPhrase(data, gridData) {
  const totalClues = Object.keys(data.across)
    .concat(Object.keys(data.down))
    .map((n) => parseInt(n, 10))
    .reduce((n, m) => Math.max(n, m));

  const seedPhrase = [];

  for (let i = 1; i <= totalClues; i += 1) {
    let word = "";
    const iString = i.toString();

    if (Object.prototype.hasOwnProperty.call(data.across, iString)) {
      const answerLength = data.across[i].answer.length;
      for (let j = 0; j < answerLength; j += 1) {
        word += gridData[data.across[i].row][data.across[i].col + j].guess;
      }
      seedPhrase.push(word);
    }

    word = "";
    if (Object.prototype.hasOwnProperty.call(data.down, iString)) {
      const answerLength = data.down[i].answer.length;
      for (let j = 0; j < answerLength; j += 1) {
        word += gridData[data.down[i].row + j][data.down[i].col].guess;
      }
      seedPhrase.push(word);
    }
  }

  const finalSeedPhrase = seedPhrase.map((w) => w.toLowerCase()).join(" ");
  console.log(
    `Crossword solution as seed phrase: %c${finalSeedPhrase}`,
    "color: #00C1DE;"
  );
  return finalSeedPhrase;
}

export function generateNewPuzzleSeedPhrase(data) {
  const totalClues = Object.keys(data.across)
    .concat(Object.keys(data.down))
    .map((n) => parseInt(n, 10))
    .reduce((n, m) => Math.max(n, m));

  const seedPhrase = [];

  for (let i = 1; i <= totalClues; i += 1) {
    const iString = i.toString();
    if (Object.prototype.hasOwnProperty.call(data.across, iString)) {
      seedPhrase.push(data.across[i].answer);
    }
    if (Object.prototype.hasOwnProperty.call(data.down, iString)) {
      seedPhrase.push(data.down[i].answer);
    }
  }

  const finalSeedPhrase = seedPhrase.map((w) => w.toLowerCase()).join(" ");
  console.log(
    `Crossword solution as seed phrase: %c${finalSeedPhrase}`,
    "color: #00C1DE;"
  );
  return finalSeedPhrase;
}

// Taken from Mozilla docs here:
// https://developer.mozilla.org/en-US/docs/Glossary/Base64#solution_1_%E2%80%93_escaping_the_string_before_encoding_it
export function b64toUtf8(str) {
  return decodeURIComponent(escape(window.atob(str)));
}
