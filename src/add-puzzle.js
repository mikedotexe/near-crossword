import getConfig from './config.js';
import { connect, WalletConnection, keyStores, utils } from 'near-api-js';
import { generateNewPuzzleSeedPhrase } from './utils';
import { parseSeedPhrase } from 'near-seed-phrase';

export const addNewPuzzle = async (mungedLayout, layout, dimensions, prizeDeposit, contractId) => {
  const nearConfig = getConfig(process.env.NEAR_ENV || 'testnet');
  const keyStore = new keyStores.BrowserLocalStorageKeyStore();
  nearConfig.keyStore = keyStore;
  const near = await connect(nearConfig);
  const wallet = new WalletConnection(near);

  const cleanLayout = layout.map(clueAnswer => {
    // remove answer and capitalize direction value to match expected structure on smart contract
    const {answer, direction, ...everythingElse} = clueAnswer
    const newDirection = direction === "down" ? "Down" : "Across"
    return {
      ...everythingElse,
      direction: newDirection
    }
  })

  const trueDeposit = utils.format.parseNearAmount(prizeDeposit)

  const account = wallet.account()

  const seedPhrase = generateNewPuzzleSeedPhrase(mungedLayout)
  const answer_pk = parseSeedPhrase(seedPhrase)

  const methodArgs = {
    answer_pk: answer_pk.publicKey,
    dimensions,
    answers: cleanLayout
  };
  const result = await account.functionCall({
    contractId,
    methodName: "new_puzzle",
    args: Buffer.from(JSON.stringify(methodArgs)),
    gas: 300000000000000, // Optional, this is the maximum allowed case
    attachedDeposit: trueDeposit
  });
}
