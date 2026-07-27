"use client";

import type { PaymentRequired } from "@x402/core/types";
import type {
  SignDelegateActionResult,
  SignDelegateActionsResponse,
} from "@fastnear/wallet";
import {
  registerX402BrowserPayer,
  type X402BrowserPayer,
} from "./x402-browser";

export type NearWalletNetwork = "mainnet" | "testnet";

export interface FastNearDelegateWallet {
  accountId(options: { network: NearWalletNetwork }): string | null;
  signDelegateActions(input: {
    network: NearWalletNetwork;
    signerId: string;
    delegateActions: Array<{
      receiverId: string;
      blockHeightTtl: number;
      actions: Array<{
        type: "FunctionCall";
        params: {
          methodName: "ft_transfer";
          args: { receiver_id: string; amount: string };
          gas: string;
          deposit: string;
        };
      }>;
    }>;
  }): Promise<SignDelegateActionsResponse>;
}

function canonicalSignedDelegate(
  result: SignDelegateActionResult | undefined,
): string {
  if (typeof result === "string" && result.length > 0) return result;
  if (
    result &&
    typeof result === "object" &&
    "borshSerializedBase64" in result &&
    typeof result.borshSerializedBase64 === "string" &&
    result.borshSerializedBase64.length > 0
  ) {
    return result.borshSerializedBase64;
  }
  throw new Error(
    "The selected wallet did not return the canonical signed-delegate format required by x402.",
  );
}

/**
 * Adapts FastNEAR's timeout-aware wallet signing to @x402/near without ever
 * exposing a wallet private key to the application.
 */
export function createFastNearX402Payer(
  wallet: FastNearDelegateWallet,
  network: NearWalletNetwork,
): X402BrowserPayer {
  return {
    async createPaymentHeaders({ paymentRequired }) {
      const [{ x402Client }, { x402HTTPClient }, near, nearClient] =
        await Promise.all([
          import("@x402/core/client"),
          import("@x402/core/http"),
          import("@x402/near"),
          import("@x402/near/exact/client"),
        ]);
      const signer = {
        async createSignedDelegateAction(input: {
          paymentRequirements: {
            network: string;
            asset: string;
            payTo: string;
            amount: string;
            maxTimeoutSeconds: number;
          };
        }): Promise<string> {
          const requirement = input.paymentRequirements;
          if (requirement.network !== `near:${network}`) {
            throw new Error(
              `The x402 request is for ${requirement.network}, but the connected wallet is on near:${network}.`,
            );
          }
          const signerId = wallet.accountId({ network });
          if (!signerId) {
            throw new Error("Reconnect the NEAR wallet before authorizing x402.");
          }
          const blockHeightTtl = Number(
            near.computeTimeoutBlocks(requirement.maxTimeoutSeconds),
          );
          if (!Number.isSafeInteger(blockHeightTtl) || blockHeightTtl <= 0) {
            throw new Error("The x402 delegate timeout is invalid.");
          }
          const signed = await wallet.signDelegateActions({
            network,
            signerId,
            delegateActions: [
              {
                receiverId: requirement.asset,
                blockHeightTtl,
                actions: [
                  {
                    type: "FunctionCall",
                    params: {
                      methodName: "ft_transfer",
                      args: {
                        receiver_id: requirement.payTo,
                        amount: requirement.amount,
                      },
                      gas: near.DEFAULT_FT_TRANSFER_GAS.toString(),
                      deposit: near.ONE_YOCTO.toString(),
                    },
                  },
                ],
              },
            ],
          });
          return canonicalSignedDelegate(signed.signedDelegateActions[0]);
        },
      };
      const core = new x402Client().register(
        `near:${network}`,
        new nearClient.ExactNearScheme(signer),
      );
      const http = new x402HTTPClient(core);
      const payload = await http.createPaymentPayload(
        paymentRequired as unknown as PaymentRequired,
      );
      return http.encodePaymentSignatureHeader(payload);
    },
  };
}

export function configuredBrowserNearNetwork(): NearWalletNetwork {
  const configured = process.env.NEXT_PUBLIC_NEAR_NETWORK;
  if (configured === "mainnet" || configured === "testnet") return configured;
  throw new Error(
    "NEXT_PUBLIC_NEAR_NETWORK must be configured before connecting an x402 payer.",
  );
}

export async function connectFastNearX402Payer(): Promise<{
  accountId: string;
  network: NearWalletNetwork;
}> {
  const network = configuredBrowserNearNetwork();
  const wallet = await import("@fastnear/wallet");
  const requiredFeatures = {
    signDelegateActions: true,
    signDelegateActionsWithTtl: true,
  };
  const restored = await wallet.restore({
    network,
    features: requiredFeatures,
  });
  const connection =
    restored ??
    (await wallet.connect({
      network,
      features: requiredFeatures,
    }));
  if (!connection?.accountId) {
    throw new Error("No compatible NEAR wallet was connected.");
  }
  registerX402BrowserPayer(createFastNearX402Payer(wallet, network));
  return { accountId: connection.accountId, network };
}
