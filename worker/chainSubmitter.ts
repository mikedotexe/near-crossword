import { connect, keyStores, KeyPair, utils } from "near-api-js";
import type { Near } from "near-api-js";
import config from "./config.js";
import type { GridDimensions, ContractAnswer } from "./types.js";

let nearConnection: Near | null = null;

async function getNearConnection(): Promise<Near> {
  if (nearConnection) return nearConnection;

  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(config.nearPrivateKey);
  await keyStore.setKey(
    config.nearNetwork,
    config.nearAccountId,
    keyPair
  );

  nearConnection = await connect({
    networkId: config.nearNetwork,
    nodeUrl: config.nearNodeUrl,
    keyStore,
  } as any);

  return nearConnection;
}

export async function submitNewPuzzle(
  answerPk: string,
  dimensions: GridDimensions,
  contractAnswers: ContractAnswer[],
  rewardNear: string
): Promise<string> {
  const near = await getNearConnection();
  const account = await near.account(config.nearAccountId);

  const depositYocto = utils.format.parseNearAmount(rewardNear);

  const result = await account.functionCall({
    contractId: config.nearAccountId,
    methodName: "new_puzzle",
    args: {
      answer_pk: answerPk,
      dimensions,
      answers: contractAnswers,
    },
    gas: "300000000000000" as any,
    attachedDeposit: depositYocto as any,
  });

  return (result as any).transaction.hash;
}

export async function getAccountBalance(): Promise<string> {
  const near = await getNearConnection();
  const account = await near.account(config.nearAccountId);
  const balance = await account.getAccountBalance();
  return utils.format.formatNearAmount(balance.available, 2);
}
