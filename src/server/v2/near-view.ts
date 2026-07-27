import { AppError } from "./errors";
import { campaignContractId, isExplicitMockMode } from "./config";

interface ContractCampaignView {
  claim_nonce?: number | string;
  status?: { state?: string } | string;
}

export async function getCampaignClaimNonce(
  campaignId: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (isExplicitMockMode()) return "0";
  const network = process.env.NEXT_PUBLIC_NEAR_NETWORK || process.env.NEAR_NETWORK;
  const rpcUrl =
    process.env.V2_NEAR_RPC_URL ||
    (network === "testnet"
      ? "https://test.rpc.fastnear.com"
      : "https://free.rpc.fastnear.com");
  let response: Response;
  try {
    response = await fetcher(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "crossword-campaign-view",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: campaignContractId(),
          method_name: "get_campaign",
          args_base64: Buffer.from(JSON.stringify({ campaign_id: campaignId })).toString(
            "base64",
          ),
        },
      }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
  } catch {
    throw new AppError(503, "CONTRACT_VIEW_UNAVAILABLE", "Contract state is unavailable");
  }
  const payload = await response.json().catch(() => null);
  if (
    !response.ok ||
    !payload ||
    typeof payload !== "object" ||
    !("result" in payload) ||
    !(payload as { result?: { result?: number[] } }).result?.result
  ) {
    throw new AppError(503, "CONTRACT_VIEW_UNAVAILABLE", "Contract state is unavailable");
  }
  const bytes = (payload as { result: { result: number[] } }).result.result;
  const view = JSON.parse(Buffer.from(bytes).toString("utf8")) as ContractCampaignView | null;
  if (!view) throw new AppError(409, "CAMPAIGN_NOT_ON_CHAIN", "Campaign is not on-chain");
  const state =
    typeof view.status === "string" ? view.status : view.status?.state;
  if (state && state.toLowerCase() !== "active") {
    throw new AppError(409, "CAMPAIGN_NOT_ACTIVE", "On-chain campaign is not active");
  }
  const nonce = String(view.claim_nonce ?? "");
  if (!/^(?:0|[1-9][0-9]*)$/.test(nonce)) {
    throw new AppError(502, "INVALID_CONTRACT_VIEW", "Contract claim nonce is invalid");
  }
  return nonce;
}
