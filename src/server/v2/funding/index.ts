import { isExplicitMockMode } from "../config";
import type { FundingRail } from "../types";
import type { FundingAdapter } from "./types";
import { DeterministicMockFundingAdapter } from "./mock";
import { DirectNearFundingAdapter } from "./direct-near";
import { OneClickFundingAdapter } from "./one-click";

export function fundingAdapter(rail: FundingRail): FundingAdapter {
  if (isExplicitMockMode()) return new DeterministicMockFundingAdapter();
  if (rail === "DIRECT_NEAR") return new DirectNearFundingAdapter();
  if (rail === "ONE_CLICK") return new OneClickFundingAdapter();
  throw new Error("MOCK rail is disabled outside explicit local mock mode");
}

export {
  augmentExternalFundingQuoteInstructions,
  buildExternalFundingAuthorizationInstruction,
  DEFAULT_EXTERNAL_AUTHORIZATION_STORAGE_DEPOSIT_YOCTO,
  EXTERNAL_AUTHORIZATION_FUNCTION_CALL_GAS,
  EXTERNAL_AUTHORIZATION_STORAGE_NOTICE,
  EXTERNAL_FUNDING_ALLOCATION_GRACE_MS,
  EXTERNAL_FUNDING_AUTHORIZATION_INSTRUCTION_KEY,
} from "./external-authorization";

export type {
  AdapterQuoteRequest,
  FinalizationDecision,
  FundingAdapter,
  FundingObservation,
  FundingQuoteRequest,
  PayoutQuoteRequest,
} from "./types";
export type {
  ExternalFundingAuthorizationContractArgs,
  ExternalFundingAuthorizationInstruction,
  ExternalFundingAuthorizationOptions,
} from "./external-authorization";
