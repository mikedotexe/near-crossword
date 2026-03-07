import getConfig from './config.js';
import * as near from "@fastnear/api";
import { generateNewPuzzleSeedPhrase } from './utils';
import { parseSeedPhrase } from 'near-seed-phrase';
import ApiManager from "./ApiManager";

export const addNewPuzzle = async (mungedLayout, layout, dimensions, prizeDeposit) => {
  const nearConfig = getConfig(
    process.env.NEXT_PUBLIC_NEAR_NETWORK || "testnet"
  );
  const api = await ApiManager.instance();
  await api.ready();

  if (!api.isSignedIn()) {
    const connected = await api.signIn();
    if (!connected) {
      return null;
    }
  }

  const cleanLayout = layout.map(clueAnswer => {
    // remove answer and capitalize direction value to match expected structure on smart contract
    const {answer, direction, ...everythingElse} = clueAnswer
    const newDirection = direction === "down" ? "Down" : "Across"
    return {
      ...everythingElse,
      direction: newDirection
    }
  })

  const seedPhrase = generateNewPuzzleSeedPhrase(mungedLayout)
  const answer_pk = parseSeedPhrase(seedPhrase)

  const methodArgs = {
    answer_pk: answer_pk.publicKey,
    dimensions,
    answers: cleanLayout
  };

  const result = await api.sendTransaction({
    signerId: api.accountId(),
    receiverId: nearConfig.contractName,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName: "new_puzzle",
          args: methodArgs,
          gas: "300000000000000",
          deposit: near.utils.convertUnit(`${prizeDeposit} NEAR`),
        },
      },
    ],
  });

  return result;

}
