import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as near from "@fastnear/api";
import getConfig from "../config";
import {
  b64toUtf8,
  mungeBlockchainCrossword,
  parseSolutionSeedPhrase,
  viewMethodOnContract,
} from "../utils";
import { trackEvent } from "./analytics";
import {
  getTransactionFailure,
  getTransactionHash,
  getTransactionStatus,
  getTransactionSuccessValue,
} from "./txResult";

const AppFlowContext = createContext(null);

const envName = () => process.env.NEXT_PUBLIC_NEAR_NETWORK || "testnet";
const DEFAULT_PLACEHOLDER_CONTRACT = "your-crossword-account.testnet";

const loadSeedPhrase = async () => {
  const importedModule = await import("near-seed-phrase");
  return importedModule.default || importedModule;
};

const loadCrosswordUtils = async () => {
  const importedModule = await import("@crosswordxyz/react-crossword/util");
  return importedModule.default || importedModule;
};

const configureLocalSigning = (nearConfig, privateKey) => {
  near.config({
    networkId: nearConfig.networkId,
    nodeUrl: nearConfig.nodeUrl,
  });
  near.state.update({
    accountId: nearConfig.contractName,
    privateKey,
    accessKeyContractId: nearConfig.contractName,
  });
};

const getConfigWarningMessage = (nearConfig, error) => {
  const network = nearConfig.networkId || "testnet";
  const contract = nearConfig.contractName || "(unset)";

  if (error?.isMethodMissing) {
    return `Crossword contract methods were not found on ${network}: ${contract}. Set NEXT_PUBLIC_CONTRACT_NAME (and optionally NEXT_PUBLIC_NEAR_NETWORK) or run yarn dev to deploy a local dev contract.`;
  }

  return `Contract account not found on ${network}: ${contract}. Set NEXT_PUBLIC_CONTRACT_NAME (and optionally NEXT_PUBLIC_NEAR_NETWORK) or run yarn dev to deploy a local dev contract.`;
};

export const AppFlowProvider = ({ children }) => {
  const [initLoading, setInitLoading] = useState(true);
  const [initError, setInitError] = useState("");
  const [configWarning, setConfigWarning] = useState("");
  const [nearConfig, setNearConfig] = useState(null);
  const [data, setData] = useState(null);
  const [playerKeyPair, setPlayerKeyPair] = useState(null);
  const [crosswordSolutionPublicKey, setCrosswordSolutionPublicKey] =
    useState(null);

  const [solvedPuzzle, setSolvedPuzzle] = useState(null);
  const [showLoader, setShowLoader] = useState(false);
  const [needsNewAccount, setNeedsNewAccount] = useState(false);
  const [claimError, setClaimError] = useState("");
  const clearConfigWarning = useCallback(() => {
    setConfigWarning("");
  }, []);

  const hydrateChainData = useCallback(async () => {
    const config = getConfig(envName());

    const existingKey = localStorage.getItem("playerKeyPair");
    let keyPair = existingKey ? JSON.parse(existingKey) : null;

    if (!keyPair) {
      const nearSeedPhrase = await loadSeedPhrase();
      const generateSeedPhrase =
        nearSeedPhrase.generateSeedPhrase ||
        nearSeedPhrase.default?.generateSeedPhrase;

      if (!generateSeedPhrase) {
        throw new Error("Unable to load seed phrase generator.");
      }

      keyPair = generateSeedPhrase();
      localStorage.setItem("playerKeyPair", JSON.stringify(keyPair));
    }

    let chainData;
    try {
      chainData = await viewMethodOnContract(config, "get_unsolved_puzzles");
      setConfigWarning("");
    } catch (error) {
      const isRecoverableConfigError = Boolean(
        error?.isUnknownAccount || error?.isMethodMissing
      );

      if (!isRecoverableConfigError) {
        throw error;
      }

      console.warn("Contract configuration warning during hydrate:", error);
      setConfigWarning(getConfigWarningMessage(config, error));
      chainData = { puzzles: [] };
    }

    let crosswordData = null;
    let solutionKey = null;

    if (chainData.puzzles.length) {
      solutionKey = chainData.puzzles[0].solution_public_key;
      localStorage.setItem("crosswordSolutionPublicKey", solutionKey);
      crosswordData = mungeBlockchainCrossword(chainData.puzzles);
    } else {
      localStorage.removeItem("crosswordSolutionPublicKey");
    }

    setNearConfig(config);
    setData(crosswordData);
    setPlayerKeyPair(keyPair);
    setCrosswordSolutionPublicKey(solutionKey);

    const solvedPuzzleValue = localStorage.getItem("playerSolvedPuzzle");
    setSolvedPuzzle(solvedPuzzleValue || null);

    if (
      config.contractName === DEFAULT_PLACEHOLDER_CONTRACT &&
      (!chainData.puzzles || chainData.puzzles.length === 0)
    ) {
      setConfigWarning(
        `Contract account not found on ${config.networkId}: ${config.contractName}. Set NEXT_PUBLIC_CONTRACT_NAME (and optionally NEXT_PUBLIC_NEAR_NETWORK) or run yarn dev to deploy a local dev contract.`
      );
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    setInitLoading(true);
    hydrateChainData()
      .catch((error) => {
        console.error("Failed to initialize crossword app:", error);
        if (mounted) {
          setInitError(error.message || "Failed to initialize app.");
        }
      })
      .finally(() => {
        if (mounted) {
          setInitLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [hydrateChainData]);

  const claimCompleted = solvedPuzzle === false && claimError === "";
  const hasActivePuzzle = Boolean(data && solvedPuzzle === null);

  const resolveRoute = useCallback(
    (target) => {
      switch (target) {
        case "play":
          if (solvedPuzzle) {
            return "/claim";
          }
          if (claimCompleted) {
            return "/claimed";
          }
          if (!data) {
            return "/empty";
          }
          return null;
        case "claim":
          if (!solvedPuzzle) {
            if (claimCompleted) {
              return "/claimed";
            }
            return data ? "/play" : "/empty";
          }
          return null;
        case "claimed":
          if (!claimCompleted) {
            if (solvedPuzzle) {
              return "/claim";
            }
            return data ? "/play" : "/empty";
          }
          return null;
        case "empty":
          if (solvedPuzzle) {
            return "/claim";
          }
          if (claimCompleted) {
            return "/claimed";
          }
          if (data) {
            return "/play";
          }
          return null;
        default:
          return null;
      }
    },
    [claimCompleted, data, solvedPuzzle]
  );

  const claimPrize = useCallback(
    async (event) => {
      if (event?.preventDefault) {
        event.preventDefault();
      }

      if (!nearConfig || !playerKeyPair || !solvedPuzzle) {
        return false;
      }

      const winnerAccountField = document.getElementById("claim-account-id");
      const memoField = document.getElementById("claim-memo");

      if (!winnerAccountField || !memoField) {
        return false;
      }

      const winner_account_id = winnerAccountField.value.toLowerCase();
      const memo = memoField.value;

      trackEvent("claim_submit", {
        needs_new_account: String(needsNewAccount),
      });

      let transaction;
      try {
        setShowLoader(true);
        configureLocalSigning(nearConfig, playerKeyPair.secretKey);

        if (needsNewAccount) {
          transaction = await near.sendTx({
            receiverId: nearConfig.contractName,
            actions: [
              near.actions.functionCall({
                methodName: "claim_reward_new_account",
                args: {
                  crossword_pk: solvedPuzzle,
                  new_acc_id: winner_account_id,
                  new_pk: playerKeyPair.publicKey,
                  memo,
                },
                gas: "300000000000000",
                deposit: "0",
              }),
            ],
            waitUntil: "EXECUTED_OPTIMISTIC",
          });
        } else {
          transaction = await near.sendTx({
            receiverId: nearConfig.contractName,
            actions: [
              near.actions.functionCall({
                methodName: "claim_reward",
                args: {
                  crossword_pk: solvedPuzzle,
                  receiver_acc_id: winner_account_id,
                  memo,
                },
                gas: "300000000000000",
                deposit: "0",
              }),
            ],
            waitUntil: "EXECUTED_OPTIMISTIC",
          });
        }
      } catch (error) {
        console.error("Unexpected error when claiming", error);
        if (error.message && error.message.includes("Can not sign transactions")) {
          console.log("Someone already solved this puzzle.");
        }
      } finally {
        setShowLoader(false);
      }

      if (!transaction) {
        setClaimError(
          "Couldn't transfer reward to that account, please try another account name or create a new one."
        );
        return false;
      }

      const txSuccessValueBase64 = getTransactionSuccessValue(transaction);
      if (txSuccessValueBase64 === null) {
        const txFailure = getTransactionFailure(transaction);
        setClaimError(
          `Error with transaction: ${
            txFailure ? JSON.stringify(txFailure) : "Unknown failure"
          }`
        );
        return false;
      }

      const txSuccessValue = b64toUtf8(txSuccessValueBase64);
      if (txSuccessValue !== "true") {
        if (needsNewAccount) {
          setClaimError(
            "Could not create that account, please try another account name."
          );
        } else {
          setClaimError(
            "Couldn't transfer reward to that account, please try another account name or create a new one."
          );
        }
        return false;
      }

      setSolvedPuzzle(false);
      setClaimError("");
      localStorage.removeItem("playerSolvedPuzzle");
      localStorage.removeItem("guesses");
      trackEvent("claim_success");
      return true;
    },
    [nearConfig, needsNewAccount, playerKeyPair, solvedPuzzle]
  );

  const onCrosswordComplete = useCallback(
    async (completeCount) => {
      if (
        completeCount === false ||
        !data ||
        !nearConfig ||
        !playerKeyPair ||
        !crosswordSolutionPublicKey
      ) {
        return;
      }

      const crosswordUtils = await loadCrosswordUtils();
      const gridData = crosswordUtils.createGridData(data).gridData;
      crosswordUtils.loadGuesses(gridData, "guesses");

      const seedPhrase = parseSolutionSeedPhrase(data, gridData);
      const nearSeedPhrase = await loadSeedPhrase();
      const parseSeedPhrase =
        nearSeedPhrase.parseSeedPhrase || nearSeedPhrase.default?.parseSeedPhrase;

      if (!parseSeedPhrase) {
        throw new Error("Unable to load seed phrase parser.");
      }

      const { secretKey, publicKey } = parseSeedPhrase(seedPhrase);

      if (publicKey !== crosswordSolutionPublicKey) {
        return;
      }

      let transaction;
      try {
        setShowLoader(true);
        configureLocalSigning(nearConfig, secretKey);
        transaction = await near.sendTx({
          receiverId: nearConfig.contractName,
          actions: [
            near.actions.functionCall({
              methodName: "submit_solution",
              args: {
                solver_pk: playerKeyPair.publicKey,
              },
              gas: "300000000000000",
              deposit: "0",
            }),
          ],
          waitUntil: "EXECUTED_OPTIMISTIC",
        });

        if (getTransactionFailure(transaction)) {
          throw new Error(
            `submit_solution failed: ${JSON.stringify(
              getTransactionFailure(transaction)
            )}`
          );
        }

        localStorage.setItem("playerSolvedPuzzle", crosswordSolutionPublicKey);
        setSolvedPuzzle(crosswordSolutionPublicKey);
      } catch (error) {
        if (error.message && error.message.includes("Can not sign transactions")) {
          console.log("Someone already solved this puzzle.");
        }
      } finally {
        setShowLoader(false);
        if (transaction) {
          console.log("Transaction status:", getTransactionStatus(transaction));
          console.log("Transaction hash:", getTransactionHash(transaction));
        }
      }
    },
    [crosswordSolutionPublicKey, data, nearConfig, playerKeyPair]
  );

  const value = useMemo(
    () => ({
      claimCompleted,
      claimError,
      claimPrize,
      claimStatusClasses: claimError !== "" ? "show" : "hide",
      data,
      configWarning,
      clearConfigWarning,
      hasActivePuzzle,
      initError,
      initLoading,
      nearConfig,
      needsNewAccount,
      onCrosswordComplete,
      playerKeyPair,
      resolveRoute,
      setClaimError,
      setNeedsNewAccount,
      setSolvedPuzzle,
      showLoader,
      solvedPuzzle,
    }),
    [
      claimCompleted,
      claimError,
      claimPrize,
      data,
      configWarning,
      clearConfigWarning,
      hasActivePuzzle,
      initError,
      initLoading,
      nearConfig,
      needsNewAccount,
      onCrosswordComplete,
      playerKeyPair,
      resolveRoute,
      showLoader,
      solvedPuzzle,
    ]
  );

  return (
    <AppFlowContext.Provider value={value}>{children}</AppFlowContext.Provider>
  );
};

export const useAppFlow = () => {
  const context = useContext(AppFlowContext);
  if (!context) {
    throw new Error("useAppFlow must be used inside AppFlowProvider.");
  }
  return context;
};
