use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedMap, UnorderedSet};
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json};
use near_sdk::{
    env, ext_contract, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};

const CLAIM_DOMAIN: &[u8] = b"crossword-campaign-claim:v1";
const MIN_CAMPAIGN_DURATION_MS: u64 = 60 * 60 * 1_000;
const MAX_CAMPAIGN_DURATION_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
const MAX_USDC_PRIZE: u128 = 100_000_000;
const MAX_CAMPAIGN_ID_BYTES: usize = 64;
const MAX_FUNDING_REFERENCE_BYTES: usize = 160;
const MAX_PROMISE_RESULT_BYTES: usize = 128;

const GAS_FT_BALANCE_OF: Gas = Gas::from_tgas(8);
const GAS_EXTERNAL_FUNDING_CALLBACK: Gas = Gas::from_tgas(18);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_TRANSFER_CALLBACK: Gas = Gas::from_tgas(20);

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Campaigns,
    UsedFundingReferences,
    PendingExternalFunding,
    PendingCampaignIds,
    ExternalFundingAuthorizations,
    ExternalAuthorizationByCampaignId,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub enum FundingRail {
    DirectUsdc,
    Intents,
    X402,
}

#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub enum RefundOrigin {
    Scheduled,
    Active,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub enum CampaignStatus {
    Scheduled,
    Active,
    Claiming {
        receiver_id: AccountId,
        payout_digest: [u8; 32],
        nonce: u64,
        deadline_ms: u64,
    },
    Claimed {
        receiver_id: AccountId,
        payout_digest: [u8; 32],
        nonce: u64,
        claimed_at_ms: u64,
    },
    Refunding {
        refund_account_id: AccountId,
        origin: RefundOrigin,
        attempt: u64,
        in_flight: bool,
    },
    Refunded {
        refund_account_id: AccountId,
        refunded_at_ms: u64,
    },
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Campaign {
    campaign_id: String,
    creator_id: AccountId,
    controller_id: AccountId,
    sponsor_id: AccountId,
    content_hash: [u8; 32],
    solution_public_key: [u8; 32],
    amount: u128,
    opens_at_ms: u64,
    expires_at_ms: u64,
    refund_account_id: AccountId,
    claim_nonce: u64,
    funding_reference: String,
    funding_rail: FundingRail,
    status: CampaignStatus,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
struct PendingExternalFunding {
    authorization: ExternalFundingAuthorization,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
struct ExternalFundingAuthorization {
    campaign: Campaign,
    funding_deadline_ms: u64,
    storage_deposit: u128,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CampaignSpec {
    pub campaign_id: String,
    pub creator_id: AccountId,
    pub controller_id: Option<AccountId>,
    pub content_hash: Base64VecU8,
    pub solution_public_key: Base64VecU8,
    pub opens_at_ms: u64,
    pub expires_at_ms: u64,
    pub refund_account_id: AccountId,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde", tag = "action", rename_all = "snake_case")]
pub enum FtFundingMessage {
    CreateCampaign {
        campaign: CampaignSpec,
        funding_reference: String,
        funding_deadline_ms: u64,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ExternalFundingArgs {
    pub campaign: CampaignSpec,
    pub amount: U128,
    pub funding_reference: String,
    pub funding_rail: FundingRail,
    pub sponsor_id: AccountId,
    pub funding_deadline_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ExternalFundingActivationArgs {
    pub campaign_id: String,
    pub funding_reference: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ClaimArgs {
    pub campaign_id: String,
    pub receiver_id: AccountId,
    pub payout_digest: Base64VecU8,
    pub nonce: u64,
    pub deadline_ms: u64,
    pub signature: Base64VecU8,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ClaimMessageArgs {
    pub campaign_id: String,
    pub receiver_id: AccountId,
    pub payout_digest: Base64VecU8,
    pub nonce: u64,
    pub deadline_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde", tag = "state", rename_all = "snake_case")]
pub enum CampaignStatusView {
    Scheduled,
    Active,
    Claiming {
        receiver_id: AccountId,
        payout_digest: Base64VecU8,
        nonce: u64,
        deadline_ms: u64,
    },
    Claimed {
        receiver_id: AccountId,
        payout_digest: Base64VecU8,
        nonce: u64,
        claimed_at_ms: u64,
    },
    Refunding {
        refund_account_id: AccountId,
        origin: RefundOrigin,
        attempt: u64,
        in_flight: bool,
    },
    Refunded {
        refund_account_id: AccountId,
        refunded_at_ms: u64,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CampaignView {
    pub campaign_id: String,
    pub creator_id: AccountId,
    pub controller_id: AccountId,
    pub sponsor_id: AccountId,
    pub content_hash: Base64VecU8,
    pub solution_public_key: Base64VecU8,
    pub amount: U128,
    pub opens_at_ms: u64,
    pub expires_at_ms: u64,
    pub refund_account_id: AccountId,
    pub claim_nonce: u64,
    pub funding_reference: String,
    pub funding_rail: FundingRail,
    pub status: CampaignStatusView,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ContractConfigView {
    pub owner_id: AccountId,
    pub operator_id: AccountId,
    pub usdc_contract_id: AccountId,
    pub max_usdc_prize: U128,
    pub min_campaign_duration_ms: u64,
    pub max_campaign_duration_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct AccountingView {
    pub total_reserved: U128,
    pub computed_liabilities: U128,
    pub invariant_holds: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ExternalFundingAuthorizationView {
    pub campaign_id: String,
    pub creator_id: AccountId,
    pub controller_id: AccountId,
    pub sponsor_id: AccountId,
    pub content_hash: Base64VecU8,
    pub solution_public_key: Base64VecU8,
    pub amount: U128,
    pub opens_at_ms: u64,
    pub expires_at_ms: u64,
    pub refund_account_id: AccountId,
    pub funding_reference: String,
    pub funding_rail: FundingRail,
    pub funding_deadline_ms: u64,
    pub expired: bool,
    pub pending: bool,
    pub storage_deposit: U128,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ExternalFundingAuthorizationRemovalView {
    pub campaign_id: String,
    pub funding_reference: String,
    pub storage_refund: U128,
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait ExtFungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
}

#[ext_contract(ext_self)]
#[allow(dead_code)]
trait ExtCrosswordCallbacks {
    fn on_external_funding_balance(&mut self, funding_reference: String) -> bool;
    fn on_claim_transfer(&mut self, campaign_id: String, consumed_nonce: u64) -> bool;
    fn on_refund_transfer(&mut self, campaign_id: String, attempt: u64) -> bool;
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct CrosswordCampaigns {
    owner_id: AccountId,
    operator_id: AccountId,
    usdc_contract_id: AccountId,
    campaigns: UnorderedMap<String, Campaign>,
    used_funding_references: UnorderedSet<String>,
    external_funding_authorizations: LookupMap<String, ExternalFundingAuthorization>,
    external_authorization_by_campaign_id: LookupMap<String, String>,
    pending_external_funding: LookupMap<String, PendingExternalFunding>,
    pending_campaign_ids: UnorderedSet<String>,
    total_reserved: u128,
}

#[near]
impl CrosswordCampaigns {
    #[init]
    pub fn new(owner_id: AccountId, operator_id: AccountId, usdc_contract_id: AccountId) -> Self {
        Self {
            owner_id,
            operator_id,
            usdc_contract_id,
            campaigns: UnorderedMap::new(StorageKey::Campaigns),
            used_funding_references: UnorderedSet::new(StorageKey::UsedFundingReferences),
            external_funding_authorizations: LookupMap::new(
                StorageKey::ExternalFundingAuthorizations,
            ),
            external_authorization_by_campaign_id: LookupMap::new(
                StorageKey::ExternalAuthorizationByCampaignId,
            ),
            pending_external_funding: LookupMap::new(StorageKey::PendingExternalFunding),
            pending_campaign_ids: UnorderedSet::new(StorageKey::PendingCampaignIds),
            total_reserved: 0,
        }
    }

    /// NEP-141 receiver hook. Invalid messages return the complete amount so the
    /// token contract can refund the sender atomically.
    #[payable]
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        assert_eq!(
            env::predecessor_account_id(),
            self.usdc_contract_id,
            "ERR_ONLY_PINNED_USDC"
        );

        let parsed = serde_json::from_str::<FtFundingMessage>(&msg);
        let result = match parsed {
            Ok(FtFundingMessage::CreateCampaign {
                campaign,
                funding_reference,
                funding_deadline_ms,
            }) => {
                if Self::now_ms() > funding_deadline_ms {
                    Err("direct funding authorization expired".to_string())
                } else if funding_deadline_ms > campaign.expires_at_ms {
                    Err("direct funding deadline exceeds campaign expiry".to_string())
                } else {
                    self.try_create_campaign(
                        campaign,
                        amount.0,
                        funding_reference,
                        FundingRail::DirectUsdc,
                        sender_id.clone(),
                    )
                }
            }
            Err(error) => Err(format!("invalid funding message: {error}")),
        };

        match result {
            Ok(campaign_id) => {
                self.emit(
                    "campaign_funded",
                    json!({
                        "campaign_id": campaign_id,
                        "amount": amount,
                        "rail": FundingRail::DirectUsdc,
                    }),
                );
                PromiseOrValue::Value(U128(0))
            }
            Err(reason) => {
                self.emit(
                    "funding_rejected",
                    json!({
                        "sender_id": sender_id,
                        "amount": amount,
                        "reason": reason,
                    }),
                );
                PromiseOrValue::Value(amount)
            }
        }
    }

    /// Locks every prize-critical external-funding term under a creator-signed
    /// NEAR transaction before an operator can attribute pooled deposits.
    #[payable]
    pub fn authorize_external_funding(
        &mut self,
        args: ExternalFundingArgs,
    ) -> ExternalFundingAuthorizationView {
        assert!(
            matches!(args.funding_rail, FundingRail::Intents | FundingRail::X402),
            "ERR_EXTERNAL_RAIL_REQUIRED"
        );
        let caller = env::predecessor_account_id();
        assert_ne!(caller, self.operator_id, "ERR_OPERATOR_CANNOT_AUTHORIZE");
        let now_ms = Self::now_ms();
        let mut campaign = self
            .build_campaign(
                args.campaign,
                args.amount.0,
                args.funding_reference.clone(),
                args.funding_rail,
                args.sponsor_id,
            )
            .unwrap_or_else(|error| env::panic_str(&error));
        assert!(
            args.funding_deadline_ms > now_ms,
            "ERR_FUNDING_AUTHORIZATION_EXPIRED"
        );
        assert!(
            args.funding_deadline_ms <= campaign.expires_at_ms,
            "ERR_FUNDING_DEADLINE_AFTER_CAMPAIGN_EXPIRY"
        );
        // Authorization status is deliberately time-independent so an exact
        // retry remains idempotent as the opening time passes. Views and claim
        // validation already derive Scheduled -> Active from `opens_at_ms`.
        campaign.status = CampaignStatus::Scheduled;
        assert_eq!(caller, campaign.creator_id, "ERR_CREATOR_AUTH_REQUIRED");
        assert_eq!(
            caller, campaign.controller_id,
            "ERR_CONTROLLER_MUST_AUTHORIZE"
        );
        assert_eq!(
            caller, campaign.refund_account_id,
            "ERR_REFUND_ACCOUNT_MUST_AUTHORIZE"
        );

        if let Some(existing) = self
            .external_funding_authorizations
            .get(&args.funding_reference)
        {
            assert_eq!(existing.campaign, campaign, "ERR_AUTHORIZATION_CONFLICT");
            assert_eq!(
                existing.funding_deadline_ms, args.funding_deadline_ms,
                "ERR_AUTHORIZATION_CONFLICT"
            );
            assert!(
                now_ms <= existing.funding_deadline_ms,
                "ERR_FUNDING_AUTHORIZATION_EXPIRED"
            );
            self.refund_near(caller, env::attached_deposit().as_yoctonear());
            return self.external_authorization_view(existing);
        }

        assert!(
            !self
                .used_funding_references
                .contains(&args.funding_reference)
                && self
                    .pending_external_funding
                    .get(&args.funding_reference)
                    .is_none(),
            "ERR_FUNDING_REFERENCE_UNAVAILABLE"
        );

        if let Some(existing_reference) = self
            .external_authorization_by_campaign_id
            .get(&campaign.campaign_id)
        {
            let existing = self
                .external_funding_authorizations
                .get(&existing_reference)
                .unwrap_or_else(|| env::panic_str("ERR_AUTHORIZATION_INDEX_CORRUPT"));
            assert!(
                now_ms > existing.funding_deadline_ms,
                "ERR_CAMPAIGN_ID_UNAVAILABLE"
            );
            assert!(
                self.pending_external_funding
                    .get(&existing_reference)
                    .is_none(),
                "ERR_FUNDING_REFERENCE_PENDING"
            );
            let (removed, refund_account_id) =
                self.retire_external_authorization(existing_reference, "replaced");
            self.refund_near(refund_account_id, removed.storage_refund.0);
        }

        assert!(
            !self.pending_campaign_ids.contains(&campaign.campaign_id)
                && self
                    .external_authorization_by_campaign_id
                    .get(&campaign.campaign_id)
                    .is_none(),
            "ERR_CAMPAIGN_ID_UNAVAILABLE"
        );

        let storage_before = env::storage_usage();
        let mut authorization = ExternalFundingAuthorization {
            campaign: campaign.clone(),
            funding_deadline_ms: args.funding_deadline_ms,
            storage_deposit: 0,
        };
        self.external_funding_authorizations
            .insert(&args.funding_reference, &authorization);
        self.external_authorization_by_campaign_id
            .insert(&campaign.campaign_id, &args.funding_reference);
        let storage_bytes = env::storage_usage()
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("ERR_STORAGE_ACCOUNTING"));
        let required_deposit = env::storage_byte_cost()
            .as_yoctonear()
            .checked_mul(u128::from(storage_bytes))
            .unwrap_or_else(|| env::panic_str("ERR_STORAGE_DEPOSIT_OVERFLOW"));
        let attached_deposit = env::attached_deposit().as_yoctonear();
        assert!(
            attached_deposit >= required_deposit,
            "ERR_INSUFFICIENT_STORAGE_DEPOSIT"
        );
        authorization.storage_deposit = required_deposit;
        self.external_funding_authorizations
            .insert(&args.funding_reference, &authorization);
        self.refund_near(caller.clone(), attached_deposit - required_deposit);

        self.emit(
            "external_funding_authorized",
            json!({
                "campaign_id": campaign.campaign_id,
                "creator_id": caller,
                "funding_reference": args.funding_reference,
                "amount": U128(campaign.amount),
                "rail": campaign.funding_rail,
                "funding_deadline_ms": args.funding_deadline_ms,
                "storage_deposit": U128(required_deposit),
            }),
        );
        self.external_authorization_view(authorization)
    }

    /// The creator can abandon an unallocated quote at any time. A pending
    /// operator balance check is an atomic lock: whichever transaction lands
    /// first wins, so a callback can never allocate terms that were revoked.
    pub fn revoke_external_funding_authorization(
        &mut self,
        funding_reference: String,
    ) -> ExternalFundingAuthorizationRemovalView {
        let authorization = self
            .external_funding_authorizations
            .get(&funding_reference)
            .unwrap_or_else(|| env::panic_str("ERR_AUTHORIZATION_NOT_FOUND"));
        assert_eq!(
            env::predecessor_account_id(),
            authorization.campaign.creator_id,
            "ERR_CREATOR_AUTH_REQUIRED"
        );
        assert!(
            self.pending_external_funding
                .get(&funding_reference)
                .is_none(),
            "ERR_FUNDING_REFERENCE_PENDING"
        );
        let (removed, refund_account_id) =
            self.retire_external_authorization(funding_reference, "creator_revoked");
        self.refund_near(refund_account_id, removed.storage_refund.0);
        removed
    }

    /// Anyone can release an expired, unallocated quote. The storage refund
    /// always goes to the immutable creator, never to the cleanup caller.
    pub fn cleanup_expired_external_funding_authorization(
        &mut self,
        funding_reference: String,
    ) -> ExternalFundingAuthorizationRemovalView {
        let authorization = self
            .external_funding_authorizations
            .get(&funding_reference)
            .unwrap_or_else(|| env::panic_str("ERR_AUTHORIZATION_NOT_FOUND"));
        assert!(
            Self::now_ms() > authorization.funding_deadline_ms,
            "ERR_FUNDING_AUTHORIZATION_NOT_EXPIRED"
        );
        assert!(
            self.pending_external_funding
                .get(&funding_reference)
                .is_none(),
            "ERR_FUNDING_REFERENCE_PENDING"
        );
        let (removed, refund_account_id) =
            self.retire_external_authorization(funding_reference, "expired");
        self.refund_near(refund_account_id, removed.storage_refund.0);
        removed
    }

    /// Begins allocation of USDC that arrived through Intents or x402. The
    /// operator can reference only an exact creator-authorized commitment.
    pub fn activate_external_funding(&mut self, args: ExternalFundingActivationArgs) -> Promise {
        self.assert_operator();
        assert!(
            !self
                .used_funding_references
                .contains(&args.funding_reference),
            "ERR_FUNDING_REFERENCE_USED"
        );
        assert!(
            self.pending_external_funding
                .get(&args.funding_reference)
                .is_none(),
            "ERR_FUNDING_REFERENCE_PENDING"
        );
        let authorization = self
            .external_funding_authorizations
            .get(&args.funding_reference)
            .unwrap_or_else(|| env::panic_str("ERR_AUTHORIZATION_NOT_FOUND"));
        assert!(
            Self::now_ms() <= authorization.funding_deadline_ms,
            "ERR_FUNDING_AUTHORIZATION_EXPIRED"
        );
        assert_eq!(
            authorization.campaign.campaign_id, args.campaign_id,
            "ERR_AUTHORIZED_CAMPAIGN_MISMATCH"
        );
        assert!(
            self.campaigns.get(&args.campaign_id).is_none()
                && !self.pending_campaign_ids.contains(&args.campaign_id),
            "ERR_CAMPAIGN_ID_UNAVAILABLE"
        );

        let campaign = authorization.campaign.clone();
        let amount = U128(campaign.amount);
        self.pending_campaign_ids.insert(&campaign.campaign_id);
        self.pending_external_funding.insert(
            &args.funding_reference,
            &PendingExternalFunding { authorization },
        );

        self.emit(
            "external_funding_verification_started",
            json!({
                "campaign_id": campaign.campaign_id,
                "funding_reference": args.funding_reference,
                "amount": amount,
            }),
        );

        ext_ft::ext(self.usdc_contract_id.clone())
            .with_static_gas(GAS_FT_BALANCE_OF)
            .ft_balance_of(env::current_account_id())
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_EXTERNAL_FUNDING_CALLBACK)
                    .on_external_funding_balance(args.funding_reference),
            )
    }

    #[private]
    pub fn on_external_funding_balance(&mut self, funding_reference: String) -> bool {
        let Some(pending) = self.pending_external_funding.remove(&funding_reference) else {
            self.emit(
                "stale_external_funding_callback",
                json!({ "funding_reference": funding_reference }),
            );
            return false;
        };
        let pending_campaign = pending.authorization.campaign.clone();
        self.pending_campaign_ids
            .remove(&pending_campaign.campaign_id);

        let observed_balance = self.read_ft_balance_result();
        let required_balance = self
            .total_reserved
            .checked_add(pending_campaign.amount)
            .unwrap_or_else(|| env::panic_str("ERR_BALANCE_OVERFLOW"));

        let Some(balance) = observed_balance else {
            self.emit(
                "external_funding_rejected",
                json!({
                    "campaign_id": pending_campaign.campaign_id,
                    "funding_reference": funding_reference,
                    "reason": "balance_query_failed",
                }),
            );
            return false;
        };

        if balance < required_balance
            || self.campaigns.get(&pending_campaign.campaign_id).is_some()
            || self
                .used_funding_references
                .contains(&pending_campaign.funding_reference)
            || self
                .external_funding_authorizations
                .get(&funding_reference)
                .is_none_or(|authorization| authorization != pending.authorization)
        {
            self.emit(
                "external_funding_rejected",
                json!({
                    "campaign_id": pending_campaign.campaign_id,
                    "funding_reference": funding_reference,
                    "observed_balance": U128(balance),
                    "required_balance": U128(required_balance),
                    "reason": "insufficient_or_conflicting_allocation",
                }),
            );
            return false;
        }

        let campaign_id = pending_campaign.campaign_id.clone();
        let amount = pending_campaign.amount;
        let rail = pending_campaign.funding_rail.clone();
        self.external_funding_authorizations
            .remove(&funding_reference);
        let indexed_reference = self
            .external_authorization_by_campaign_id
            .remove(&campaign_id);
        assert_eq!(
            indexed_reference.as_deref(),
            Some(funding_reference.as_str()),
            "ERR_AUTHORIZATION_INDEX_CORRUPT"
        );
        self.campaigns.insert(&campaign_id, &pending_campaign);
        self.used_funding_references.insert(&funding_reference);
        self.total_reserved = required_balance;

        self.emit(
            "campaign_funded",
            json!({
                "campaign_id": campaign_id,
                "funding_reference": funding_reference,
                "amount": U128(amount),
                "rail": rail,
            }),
        );
        true
    }

    /// Starts a payout. Anyone may relay the solver's signature.
    pub fn claim(&mut self, args: ClaimArgs) -> Promise {
        let now_ms = Self::now_ms();
        let payout_digest = Self::fixed_32(&args.payout_digest.0, "ERR_PAYOUT_DIGEST_LENGTH");
        let signature = Self::fixed_64(&args.signature.0, "ERR_SIGNATURE_LENGTH");

        let mut campaign = self
            .campaigns
            .get(&args.campaign_id)
            .unwrap_or_else(|| env::panic_str("ERR_CAMPAIGN_NOT_FOUND"));

        assert!(now_ms >= campaign.opens_at_ms, "ERR_CAMPAIGN_NOT_OPEN");
        assert!(now_ms < campaign.expires_at_ms, "ERR_CAMPAIGN_EXPIRED");
        assert!(now_ms <= args.deadline_ms, "ERR_PERMIT_EXPIRED");
        assert!(
            args.deadline_ms <= campaign.expires_at_ms,
            "ERR_DEADLINE_AFTER_CAMPAIGN_EXPIRY"
        );
        assert_eq!(args.nonce, campaign.claim_nonce, "ERR_NONCE");
        assert!(
            matches!(
                campaign.status,
                CampaignStatus::Scheduled | CampaignStatus::Active
            ),
            "ERR_CAMPAIGN_NOT_CLAIMABLE"
        );

        let message = Self::claim_message_bytes(
            &env::current_account_id(),
            &args.campaign_id,
            &args.receiver_id,
            &payout_digest,
            args.nonce,
            args.deadline_ms,
        );
        assert!(
            env::ed25519_verify(&signature, &message, &campaign.solution_public_key),
            "ERR_INVALID_SOLUTION_SIGNATURE"
        );

        let consumed_nonce = campaign.claim_nonce;
        campaign.claim_nonce = campaign
            .claim_nonce
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("ERR_NONCE_OVERFLOW"));
        campaign.status = CampaignStatus::Claiming {
            receiver_id: args.receiver_id.clone(),
            payout_digest,
            nonce: consumed_nonce,
            deadline_ms: args.deadline_ms,
        };
        let amount = campaign.amount;
        self.campaigns.insert(&args.campaign_id, &campaign);

        self.emit(
            "claim_started",
            json!({
                "campaign_id": args.campaign_id,
                "receiver_id": args.receiver_id,
                "amount": U128(amount),
                "nonce": consumed_nonce,
                "payout_digest": Base64VecU8(payout_digest.to_vec()),
            }),
        );

        ext_ft::ext(self.usdc_contract_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(
                args.receiver_id,
                U128(amount),
                Some(format!("crossword campaign {}", args.campaign_id)),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_TRANSFER_CALLBACK)
                    .on_claim_transfer(args.campaign_id, consumed_nonce),
            )
    }

    #[private]
    pub fn on_claim_transfer(&mut self, campaign_id: String, consumed_nonce: u64) -> bool {
        let Some(mut campaign) = self.campaigns.get(&campaign_id) else {
            return false;
        };
        let CampaignStatus::Claiming {
            receiver_id,
            payout_digest,
            nonce,
            ..
        } = campaign.status.clone()
        else {
            self.emit(
                "stale_claim_callback",
                json!({ "campaign_id": campaign_id, "nonce": consumed_nonce }),
            );
            return false;
        };
        if nonce != consumed_nonce {
            self.emit(
                "stale_claim_callback",
                json!({ "campaign_id": campaign_id, "nonce": consumed_nonce }),
            );
            return false;
        }

        if Self::promise_succeeded() {
            self.total_reserved = self
                .total_reserved
                .checked_sub(campaign.amount)
                .unwrap_or_else(|| env::panic_str("ERR_ACCOUNTING_UNDERFLOW"));
            campaign.status = CampaignStatus::Claimed {
                receiver_id: receiver_id.clone(),
                payout_digest,
                nonce,
                claimed_at_ms: Self::now_ms(),
            };
            self.campaigns.insert(&campaign_id, &campaign);
            self.emit(
                "claim_succeeded",
                json!({
                    "campaign_id": campaign_id,
                    "receiver_id": receiver_id,
                    "amount": U128(campaign.amount),
                    "nonce": nonce,
                }),
            );
            true
        } else {
            campaign.status = CampaignStatus::Active;
            self.campaigns.insert(&campaign_id, &campaign);
            self.emit(
                "claim_failed",
                json!({
                    "campaign_id": campaign_id,
                    "receiver_id": receiver_id,
                    "nonce": nonce,
                    "next_nonce": campaign.claim_nonce,
                }),
            );
            false
        }
    }

    /// Creator or controller cancellation is allowed only before opening.
    pub fn cancel_before_open(&mut self, campaign_id: String) -> Promise {
        let campaign = self
            .campaigns
            .get(&campaign_id)
            .unwrap_or_else(|| env::panic_str("ERR_CAMPAIGN_NOT_FOUND"));
        let caller = env::predecessor_account_id();
        assert!(
            caller == campaign.creator_id
                || caller == campaign.controller_id
                || caller == self.operator_id,
            "ERR_NOT_CAMPAIGN_CONTROLLER"
        );
        assert!(Self::now_ms() < campaign.opens_at_ms, "ERR_CAMPAIGN_OPEN");
        assert!(
            matches!(campaign.status, CampaignStatus::Scheduled),
            "ERR_CAMPAIGN_NOT_CANCELLABLE"
        );
        self.start_refund(campaign_id, RefundOrigin::Scheduled)
    }

    /// Anyone may return an unclaimed prize after campaign expiry.
    pub fn expire_and_refund(&mut self, campaign_id: String) -> Promise {
        let campaign = self
            .campaigns
            .get(&campaign_id)
            .unwrap_or_else(|| env::panic_str("ERR_CAMPAIGN_NOT_FOUND"));
        assert!(
            Self::now_ms() >= campaign.expires_at_ms,
            "ERR_CAMPAIGN_NOT_EXPIRED"
        );
        let origin = match campaign.status {
            CampaignStatus::Scheduled => RefundOrigin::Scheduled,
            CampaignStatus::Active => RefundOrigin::Active,
            _ => env::panic_str("ERR_CAMPAIGN_NOT_REFUNDABLE"),
        };
        self.start_refund(campaign_id, origin)
    }

    /// Retries a failed refund. The amount and destination are immutable.
    pub fn retry_refund(&mut self, campaign_id: String) -> Promise {
        let mut campaign = self
            .campaigns
            .get(&campaign_id)
            .unwrap_or_else(|| env::panic_str("ERR_CAMPAIGN_NOT_FOUND"));
        let CampaignStatus::Refunding {
            refund_account_id,
            origin,
            attempt,
            in_flight,
        } = campaign.status.clone()
        else {
            env::panic_str("ERR_REFUND_NOT_PENDING")
        };
        assert!(!in_flight, "ERR_REFUND_ALREADY_IN_FLIGHT");
        let next_attempt = attempt
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("ERR_REFUND_ATTEMPT_OVERFLOW"));
        campaign.status = CampaignStatus::Refunding {
            refund_account_id: refund_account_id.clone(),
            origin,
            attempt: next_attempt,
            in_flight: true,
        };
        let amount = campaign.amount;
        self.campaigns.insert(&campaign_id, &campaign);
        self.emit(
            "refund_retried",
            json!({
                "campaign_id": campaign_id,
                "refund_account_id": refund_account_id,
                "attempt": next_attempt,
            }),
        );
        self.refund_promise(campaign_id, refund_account_id, amount, next_attempt)
    }

    #[private]
    pub fn on_refund_transfer(&mut self, campaign_id: String, attempt: u64) -> bool {
        let Some(mut campaign) = self.campaigns.get(&campaign_id) else {
            return false;
        };
        let CampaignStatus::Refunding {
            refund_account_id,
            origin,
            attempt: current_attempt,
            in_flight,
        } = campaign.status.clone()
        else {
            self.emit(
                "stale_refund_callback",
                json!({ "campaign_id": campaign_id, "attempt": attempt }),
            );
            return false;
        };
        if current_attempt != attempt || !in_flight {
            self.emit(
                "stale_refund_callback",
                json!({ "campaign_id": campaign_id, "attempt": attempt }),
            );
            return false;
        }

        if Self::promise_succeeded() {
            self.total_reserved = self
                .total_reserved
                .checked_sub(campaign.amount)
                .unwrap_or_else(|| env::panic_str("ERR_ACCOUNTING_UNDERFLOW"));
            campaign.status = CampaignStatus::Refunded {
                refund_account_id: refund_account_id.clone(),
                refunded_at_ms: Self::now_ms(),
            };
            self.campaigns.insert(&campaign_id, &campaign);
            self.emit(
                "refund_succeeded",
                json!({
                    "campaign_id": campaign_id,
                    "refund_account_id": refund_account_id,
                    "amount": U128(campaign.amount),
                    "attempt": attempt,
                }),
            );
            true
        } else {
            campaign.status = CampaignStatus::Refunding {
                refund_account_id: refund_account_id.clone(),
                origin,
                attempt,
                in_flight: false,
            };
            self.campaigns.insert(&campaign_id, &campaign);
            self.emit(
                "refund_failed",
                json!({
                    "campaign_id": campaign_id,
                    "refund_account_id": refund_account_id,
                    "attempt": attempt,
                }),
            );
            false
        }
    }

    pub fn get_campaign(&self, campaign_id: String) -> Option<CampaignView> {
        self.campaigns
            .get(&campaign_id)
            .map(|campaign| self.campaign_view(campaign))
    }

    pub fn get_campaigns(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<CampaignView> {
        let start = from_index.unwrap_or(0);
        let count = limit.unwrap_or(50).min(100);
        self.campaigns
            .values_as_vector()
            .iter()
            .skip(start as usize)
            .take(count as usize)
            .map(|campaign| self.campaign_view(campaign))
            .collect()
    }

    pub fn get_external_funding_authorization(
        &self,
        funding_reference: String,
    ) -> Option<ExternalFundingAuthorizationView> {
        self.external_funding_authorizations
            .get(&funding_reference)
            .map(|authorization| self.external_authorization_view(authorization))
    }

    pub fn get_config(&self) -> ContractConfigView {
        ContractConfigView {
            owner_id: self.owner_id.clone(),
            operator_id: self.operator_id.clone(),
            usdc_contract_id: self.usdc_contract_id.clone(),
            max_usdc_prize: U128(MAX_USDC_PRIZE),
            min_campaign_duration_ms: MIN_CAMPAIGN_DURATION_MS,
            max_campaign_duration_ms: MAX_CAMPAIGN_DURATION_MS,
        }
    }

    pub fn get_accounting(&self) -> AccountingView {
        let computed_liabilities = self
            .campaigns
            .values_as_vector()
            .iter()
            .filter(|campaign| Self::is_live_liability(&campaign.status))
            .fold(0u128, |sum, campaign| {
                sum.checked_add(campaign.amount)
                    .unwrap_or_else(|| env::panic_str("ERR_ACCOUNTING_OVERFLOW"))
            });
        AccountingView {
            total_reserved: U128(self.total_reserved),
            computed_liabilities: U128(computed_liabilities),
            invariant_holds: computed_liabilities == self.total_reserved,
        }
    }

    pub fn is_funding_reference_used(&self, funding_reference: String) -> bool {
        self.used_funding_references.contains(&funding_reference)
    }

    pub fn get_claim_message(&self, args: ClaimMessageArgs) -> Base64VecU8 {
        let digest = Self::fixed_32(&args.payout_digest.0, "ERR_PAYOUT_DIGEST_LENGTH");
        Base64VecU8(Self::claim_message_bytes(
            &env::current_account_id(),
            &args.campaign_id,
            &args.receiver_id,
            &digest,
            args.nonce,
            args.deadline_ms,
        ))
    }
}

impl CrosswordCampaigns {
    fn try_create_campaign(
        &mut self,
        spec: CampaignSpec,
        amount: u128,
        funding_reference: String,
        funding_rail: FundingRail,
        sponsor_id: AccountId,
    ) -> Result<String, String> {
        self.validate_reference_available(&funding_reference)?;
        if self.pending_campaign_ids.contains(&spec.campaign_id)
            || self
                .external_authorization_by_campaign_id
                .get(&spec.campaign_id)
                .is_some()
        {
            return Err("campaign ID is reserved for external funding".to_string());
        }
        let campaign = self.build_campaign(
            spec,
            amount,
            funding_reference.clone(),
            funding_rail,
            sponsor_id,
        )?;
        let campaign_id = campaign.campaign_id.clone();
        let new_total = self
            .total_reserved
            .checked_add(amount)
            .ok_or_else(|| "reserved balance overflow".to_string())?;
        self.campaigns.insert(&campaign_id, &campaign);
        self.used_funding_references.insert(&funding_reference);
        self.total_reserved = new_total;
        Ok(campaign_id)
    }

    fn build_campaign(
        &self,
        spec: CampaignSpec,
        amount: u128,
        funding_reference: String,
        funding_rail: FundingRail,
        sponsor_id: AccountId,
    ) -> Result<Campaign, String> {
        Self::validate_campaign_id(&spec.campaign_id)?;
        if self.campaigns.get(&spec.campaign_id).is_some() {
            return Err("campaign ID already exists".to_string());
        }
        Self::validate_funding_reference(&funding_reference)?;
        if amount == 0 {
            return Err("prize amount must be positive".to_string());
        }
        if amount > MAX_USDC_PRIZE {
            return Err("prize exceeds unaudited beta cap".to_string());
        }
        let now_ms = Self::now_ms();
        if spec.expires_at_ms <= now_ms {
            return Err("campaign must expire in the future".to_string());
        }
        if spec.expires_at_ms <= spec.opens_at_ms {
            return Err("campaign expiry must follow opening".to_string());
        }
        let duration = spec.expires_at_ms - spec.opens_at_ms;
        if !(MIN_CAMPAIGN_DURATION_MS..=MAX_CAMPAIGN_DURATION_MS).contains(&duration) {
            return Err("campaign duration must be between one hour and thirty days".to_string());
        }
        let content_hash = Self::try_fixed_32(&spec.content_hash.0)
            .ok_or_else(|| "content hash must be 32 bytes".to_string())?;
        let solution_public_key = Self::try_fixed_32(&spec.solution_public_key.0)
            .ok_or_else(|| "solution public key must be 32 bytes".to_string())?;
        let status = if now_ms < spec.opens_at_ms {
            CampaignStatus::Scheduled
        } else {
            CampaignStatus::Active
        };
        let controller_id = spec
            .controller_id
            .unwrap_or_else(|| spec.creator_id.clone());

        Ok(Campaign {
            campaign_id: spec.campaign_id,
            creator_id: spec.creator_id,
            controller_id,
            sponsor_id,
            content_hash,
            solution_public_key,
            amount,
            opens_at_ms: spec.opens_at_ms,
            expires_at_ms: spec.expires_at_ms,
            refund_account_id: spec.refund_account_id,
            claim_nonce: 0,
            funding_reference,
            funding_rail,
            status,
        })
    }

    fn validate_reference_available(&self, funding_reference: &str) -> Result<(), String> {
        Self::validate_funding_reference(funding_reference)?;
        let owned_reference = funding_reference.to_string();
        if self.used_funding_references.contains(&owned_reference)
            || self
                .pending_external_funding
                .get(&owned_reference)
                .is_some()
            || self
                .external_funding_authorizations
                .get(&owned_reference)
                .is_some()
        {
            return Err("funding reference already used or pending".to_string());
        }
        Ok(())
    }

    fn validate_campaign_id(campaign_id: &str) -> Result<(), String> {
        if campaign_id.is_empty() || campaign_id.len() > MAX_CAMPAIGN_ID_BYTES {
            return Err("campaign ID length is invalid".to_string());
        }
        if !campaign_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        {
            return Err("campaign ID contains unsupported characters".to_string());
        }
        Ok(())
    }

    fn validate_funding_reference(funding_reference: &str) -> Result<(), String> {
        if funding_reference.is_empty()
            || funding_reference.len() > MAX_FUNDING_REFERENCE_BYTES
            || funding_reference.chars().any(char::is_control)
        {
            return Err("funding reference is invalid".to_string());
        }
        Ok(())
    }

    fn start_refund(&mut self, campaign_id: String, origin: RefundOrigin) -> Promise {
        let mut campaign = self
            .campaigns
            .get(&campaign_id)
            .unwrap_or_else(|| env::panic_str("ERR_CAMPAIGN_NOT_FOUND"));
        let refund_account_id = campaign.refund_account_id.clone();
        campaign.status = CampaignStatus::Refunding {
            refund_account_id: refund_account_id.clone(),
            origin,
            attempt: 0,
            in_flight: true,
        };
        let amount = campaign.amount;
        self.campaigns.insert(&campaign_id, &campaign);
        self.emit(
            "refund_started",
            json!({
                "campaign_id": campaign_id,
                "refund_account_id": refund_account_id,
                "amount": U128(amount),
                "attempt": 0,
            }),
        );
        self.refund_promise(campaign_id, refund_account_id, amount, 0)
    }

    fn refund_promise(
        &self,
        campaign_id: String,
        refund_account_id: AccountId,
        amount: u128,
        attempt: u64,
    ) -> Promise {
        ext_ft::ext(self.usdc_contract_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(
                refund_account_id,
                U128(amount),
                Some(format!("crossword campaign {campaign_id} refund")),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_TRANSFER_CALLBACK)
                    .on_refund_transfer(campaign_id, attempt),
            )
    }

    fn campaign_view(&self, campaign: Campaign) -> CampaignView {
        CampaignView {
            campaign_id: campaign.campaign_id,
            creator_id: campaign.creator_id,
            controller_id: campaign.controller_id,
            sponsor_id: campaign.sponsor_id,
            content_hash: Base64VecU8(campaign.content_hash.to_vec()),
            solution_public_key: Base64VecU8(campaign.solution_public_key.to_vec()),
            amount: U128(campaign.amount),
            opens_at_ms: campaign.opens_at_ms,
            expires_at_ms: campaign.expires_at_ms,
            refund_account_id: campaign.refund_account_id,
            claim_nonce: campaign.claim_nonce,
            funding_reference: campaign.funding_reference,
            funding_rail: campaign.funding_rail,
            status: Self::status_view(campaign.status, campaign.opens_at_ms),
        }
    }

    fn external_authorization_view(
        &self,
        authorization: ExternalFundingAuthorization,
    ) -> ExternalFundingAuthorizationView {
        let campaign = authorization.campaign;
        ExternalFundingAuthorizationView {
            campaign_id: campaign.campaign_id,
            creator_id: campaign.creator_id,
            controller_id: campaign.controller_id,
            sponsor_id: campaign.sponsor_id,
            content_hash: Base64VecU8(campaign.content_hash.to_vec()),
            solution_public_key: Base64VecU8(campaign.solution_public_key.to_vec()),
            amount: U128(campaign.amount),
            opens_at_ms: campaign.opens_at_ms,
            expires_at_ms: campaign.expires_at_ms,
            refund_account_id: campaign.refund_account_id,
            funding_reference: campaign.funding_reference.clone(),
            funding_rail: campaign.funding_rail,
            funding_deadline_ms: authorization.funding_deadline_ms,
            expired: Self::now_ms() > authorization.funding_deadline_ms,
            pending: self
                .pending_external_funding
                .get(&campaign.funding_reference)
                .is_some(),
            storage_deposit: U128(authorization.storage_deposit),
        }
    }

    fn retire_external_authorization(
        &mut self,
        funding_reference: String,
        reason: &str,
    ) -> (ExternalFundingAuthorizationRemovalView, AccountId) {
        assert!(
            self.pending_external_funding
                .get(&funding_reference)
                .is_none(),
            "ERR_FUNDING_REFERENCE_PENDING"
        );
        let storage_before = env::storage_usage();
        let authorization = self
            .external_funding_authorizations
            .remove(&funding_reference)
            .unwrap_or_else(|| env::panic_str("ERR_AUTHORIZATION_NOT_FOUND"));
        let campaign_id = authorization.campaign.campaign_id.clone();
        let indexed_reference = self
            .external_authorization_by_campaign_id
            .remove(&campaign_id);
        assert_eq!(
            indexed_reference.as_deref(),
            Some(funding_reference.as_str()),
            "ERR_AUTHORIZATION_INDEX_CORRUPT"
        );
        assert!(
            self.used_funding_references.insert(&funding_reference),
            "ERR_FUNDING_REFERENCE_USED"
        );

        let released_bytes = storage_before.saturating_sub(env::storage_usage());
        let released_deposit = env::storage_byte_cost()
            .as_yoctonear()
            .checked_mul(u128::from(released_bytes))
            .unwrap_or_else(|| env::panic_str("ERR_STORAGE_DEPOSIT_OVERFLOW"));
        let storage_refund = released_deposit.min(authorization.storage_deposit);
        let creator_id = authorization.campaign.creator_id;
        let removed = ExternalFundingAuthorizationRemovalView {
            campaign_id,
            funding_reference: funding_reference.clone(),
            storage_refund: U128(storage_refund),
        };
        self.emit(
            "external_funding_authorization_removed",
            json!({
                "campaign_id": removed.campaign_id,
                "creator_id": creator_id,
                "funding_reference": funding_reference,
                "reason": reason,
                "storage_refund": removed.storage_refund,
            }),
        );
        (removed, creator_id)
    }

    fn refund_near(&self, account_id: AccountId, amount: u128) {
        if amount > 0 {
            Promise::new(account_id)
                .transfer(NearToken::from_yoctonear(amount))
                .detach();
        }
    }

    fn status_view(status: CampaignStatus, opens_at_ms: u64) -> CampaignStatusView {
        match status {
            CampaignStatus::Scheduled if Self::now_ms() >= opens_at_ms => {
                CampaignStatusView::Active
            }
            CampaignStatus::Scheduled => CampaignStatusView::Scheduled,
            CampaignStatus::Active => CampaignStatusView::Active,
            CampaignStatus::Claiming {
                receiver_id,
                payout_digest,
                nonce,
                deadline_ms,
            } => CampaignStatusView::Claiming {
                receiver_id,
                payout_digest: Base64VecU8(payout_digest.to_vec()),
                nonce,
                deadline_ms,
            },
            CampaignStatus::Claimed {
                receiver_id,
                payout_digest,
                nonce,
                claimed_at_ms,
            } => CampaignStatusView::Claimed {
                receiver_id,
                payout_digest: Base64VecU8(payout_digest.to_vec()),
                nonce,
                claimed_at_ms,
            },
            CampaignStatus::Refunding {
                refund_account_id,
                origin,
                attempt,
                in_flight,
            } => CampaignStatusView::Refunding {
                refund_account_id,
                origin,
                attempt,
                in_flight,
            },
            CampaignStatus::Refunded {
                refund_account_id,
                refunded_at_ms,
            } => CampaignStatusView::Refunded {
                refund_account_id,
                refunded_at_ms,
            },
        }
    }

    fn claim_message_bytes(
        contract_id: &AccountId,
        campaign_id: &str,
        receiver_id: &AccountId,
        payout_digest: &[u8; 32],
        nonce: u64,
        deadline_ms: u64,
    ) -> Vec<u8> {
        let mut message = Vec::with_capacity(
            CLAIM_DOMAIN.len()
                + contract_id.as_str().len()
                + campaign_id.len()
                + receiver_id.as_str().len()
                + 4 * 3
                + 32
                + 16,
        );
        message.extend_from_slice(CLAIM_DOMAIN);
        Self::append_length_prefixed(&mut message, contract_id.as_bytes());
        Self::append_length_prefixed(&mut message, campaign_id.as_bytes());
        Self::append_length_prefixed(&mut message, receiver_id.as_bytes());
        message.extend_from_slice(payout_digest);
        message.extend_from_slice(&nonce.to_le_bytes());
        message.extend_from_slice(&deadline_ms.to_le_bytes());
        message
    }

    fn append_length_prefixed(buffer: &mut Vec<u8>, bytes: &[u8]) {
        let len: u32 = bytes
            .len()
            .try_into()
            .unwrap_or_else(|_| env::panic_str("ERR_MESSAGE_FIELD_TOO_LONG"));
        buffer.extend_from_slice(&len.to_le_bytes());
        buffer.extend_from_slice(bytes);
    }

    fn read_ft_balance_result(&self) -> Option<u128> {
        let bytes = env::promise_result_checked(0, MAX_PROMISE_RESULT_BYTES).ok()?;
        serde_json::from_slice::<U128>(&bytes)
            .ok()
            .map(|value| value.0)
    }

    fn promise_succeeded() -> bool {
        env::promise_result_checked(0, MAX_PROMISE_RESULT_BYTES).is_ok()
    }

    fn now_ms() -> u64 {
        env::block_timestamp_ms()
    }

    fn fixed_32(bytes: &[u8], error: &str) -> [u8; 32] {
        Self::try_fixed_32(bytes).unwrap_or_else(|| env::panic_str(error))
    }

    fn try_fixed_32(bytes: &[u8]) -> Option<[u8; 32]> {
        bytes.try_into().ok()
    }

    fn fixed_64(bytes: &[u8], error: &str) -> [u8; 64] {
        bytes.try_into().unwrap_or_else(|_| env::panic_str(error))
    }

    fn is_live_liability(status: &CampaignStatus) -> bool {
        matches!(
            status,
            CampaignStatus::Scheduled
                | CampaignStatus::Active
                | CampaignStatus::Claiming { .. }
                | CampaignStatus::Refunding { .. }
        )
    }

    fn assert_operator(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.operator_id,
            "ERR_NOT_OPERATOR"
        );
    }

    fn emit(&self, event: &str, data: serde_json::Value) {
        env::log_str(
            &json!({
                "standard": "crossword_campaigns",
                "version": "1.0.0",
                "event": event,
                "data": [data],
            })
            .to_string()
            .insert_str_return("EVENT_JSON:"),
        );
    }
}

trait InsertStrReturn {
    fn insert_str_return(self, prefix: &str) -> String;
}

impl InsertStrReturn for String {
    fn insert_str_return(mut self, prefix: &str) -> String {
        self.insert_str(0, prefix);
        self
    }
}

#[cfg(test)]
mod tests {
    #![allow(unused_must_use)]

    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::base64::{engine::general_purpose::STANDARD as BASE64, Engine};
    use near_sdk::test_utils::{accounts, get_logs, VMContextBuilder};
    use near_sdk::{testing_env, CurveType, PromiseResult, PublicKey};
    use std::panic::{catch_unwind, AssertUnwindSafe};

    const NOW_MS: u64 = 1_730_000_000_000;
    const ONE_USDC: u128 = 1_000_000;

    fn account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn context(predecessor: AccountId, timestamp_ms: u64) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("campaigns.testnet"))
            .predecessor_account_id(predecessor.clone())
            .signer_account_id(predecessor)
            .signer_account_pk(PublicKey::from_parts(CurveType::ED25519, vec![7; 32]).unwrap())
            .block_timestamp(timestamp_ms * 1_000_000);
        builder
    }

    fn set_context(predecessor: AccountId, timestamp_ms: u64) {
        testing_env!(context(predecessor, timestamp_ms).build());
    }

    fn set_context_with_deposit(predecessor: AccountId, timestamp_ms: u64, deposit: NearToken) {
        let mut builder = context(predecessor, timestamp_ms);
        builder.attached_deposit(deposit);
        testing_env!(builder.build());
    }

    fn set_callback(result: PromiseResult, timestamp_ms: u64) {
        testing_env!(
            context(account("campaigns.testnet"), timestamp_ms).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![result]
        );
    }

    fn contract() -> CrosswordCampaigns {
        set_context(accounts(0), NOW_MS);
        CrosswordCampaigns::new(accounts(0), accounts(1), account("usdc.testnet"))
    }

    fn signing_key(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }

    fn spec(id: &str, key: &SigningKey, opens_at_ms: u64) -> CampaignSpec {
        CampaignSpec {
            campaign_id: id.to_string(),
            creator_id: accounts(2),
            controller_id: Some(accounts(3)),
            content_hash: Base64VecU8(vec![9; 32]),
            solution_public_key: Base64VecU8(key.verifying_key().to_bytes().to_vec()),
            opens_at_ms,
            expires_at_ms: opens_at_ms + 7 * 24 * 60 * 60 * 1_000,
            refund_account_id: accounts(2),
        }
    }

    fn external_args(
        id: &str,
        key: &SigningKey,
        opens_at_ms: u64,
        amount: u128,
        funding_reference: &str,
        funding_rail: FundingRail,
        sponsor_id: AccountId,
    ) -> ExternalFundingArgs {
        external_args_with_deadline(
            id,
            key,
            opens_at_ms,
            amount,
            funding_reference,
            funding_rail,
            sponsor_id,
            NOW_MS + 5 * 60 * 1_000,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn external_args_with_deadline(
        id: &str,
        key: &SigningKey,
        opens_at_ms: u64,
        amount: u128,
        funding_reference: &str,
        funding_rail: FundingRail,
        sponsor_id: AccountId,
        funding_deadline_ms: u64,
    ) -> ExternalFundingArgs {
        let mut campaign = spec(id, key, opens_at_ms);
        campaign.controller_id = Some(campaign.creator_id.clone());
        ExternalFundingArgs {
            campaign,
            amount: U128(amount),
            funding_reference: funding_reference.to_string(),
            funding_rail,
            sponsor_id,
            funding_deadline_ms,
        }
    }

    fn authorize_external(
        contract: &mut CrosswordCampaigns,
        args: ExternalFundingArgs,
        timestamp_ms: u64,
    ) -> ExternalFundingAuthorizationView {
        set_context_with_deposit(accounts(2), timestamp_ms, NearToken::from_near(1));
        contract.authorize_external_funding(args)
    }

    fn activate_external(
        contract: &mut CrosswordCampaigns,
        campaign_id: &str,
        funding_reference: &str,
        timestamp_ms: u64,
    ) {
        set_context(accounts(1), timestamp_ms);
        contract.activate_external_funding(ExternalFundingActivationArgs {
            campaign_id: campaign_id.to_string(),
            funding_reference: funding_reference.to_string(),
        });
    }

    fn direct_msg(campaign: CampaignSpec, reference: &str) -> String {
        direct_msg_with_deadline(campaign, reference, NOW_MS + 5 * 60 * 1_000)
    }

    fn direct_msg_with_deadline(
        campaign: CampaignSpec,
        reference: &str,
        funding_deadline_ms: u64,
    ) -> String {
        serde_json::to_string(&FtFundingMessage::CreateCampaign {
            campaign,
            funding_reference: reference.to_string(),
            funding_deadline_ms,
        })
        .unwrap()
    }

    fn direct_fund(
        contract: &mut CrosswordCampaigns,
        campaign: CampaignSpec,
        reference: &str,
        amount: u128,
    ) -> U128 {
        set_context(account("usdc.testnet"), NOW_MS);
        match contract.ft_on_transfer(accounts(4), U128(amount), direct_msg(campaign, reference)) {
            PromiseOrValue::Value(value) => value,
            PromiseOrValue::Promise(_) => panic!("expected immediate FT receiver result"),
        }
    }

    fn claim_args(
        contract: &CrosswordCampaigns,
        key: &SigningKey,
        campaign_id: &str,
        receiver_id: AccountId,
        digest: [u8; 32],
        nonce: u64,
        deadline_ms: u64,
    ) -> ClaimArgs {
        let message = contract
            .get_claim_message(ClaimMessageArgs {
                campaign_id: campaign_id.to_string(),
                receiver_id: receiver_id.clone(),
                payout_digest: Base64VecU8(digest.to_vec()),
                nonce,
                deadline_ms,
            })
            .0;
        ClaimArgs {
            campaign_id: campaign_id.to_string(),
            receiver_id,
            payout_digest: Base64VecU8(digest.to_vec()),
            nonce,
            deadline_ms,
            signature: Base64VecU8(key.sign(&message).to_bytes().to_vec()),
        }
    }

    fn assert_panics(f: impl FnOnce()) {
        assert!(catch_unwind(AssertUnwindSafe(f)).is_err());
    }

    #[test]
    fn direct_funding_is_atomic_and_accounted() {
        let mut contract = contract();
        let key = signing_key(1);
        let refund = direct_fund(
            &mut contract,
            spec("launch", &key, NOW_MS),
            "direct:launch",
            25 * ONE_USDC,
        );
        assert_eq!(refund.0, 0);

        let campaign = contract.get_campaign("launch".to_string()).unwrap();
        assert_eq!(campaign.amount.0, 25 * ONE_USDC);
        assert!(matches!(campaign.status, CampaignStatusView::Active));
        assert_eq!(campaign.funding_rail, FundingRail::DirectUsdc);
        assert!(contract.is_funding_reference_used("direct:launch".to_string()));
        let accounting = contract.get_accounting();
        assert_eq!(accounting.total_reserved.0, 25 * ONE_USDC);
        assert_eq!(accounting.computed_liabilities, accounting.total_reserved);
        assert!(accounting.invariant_holds);
    }

    #[test]
    fn invalid_and_duplicate_direct_funding_return_full_amount() {
        let mut contract = contract();
        let key = signing_key(2);
        assert_eq!(
            direct_fund(
                &mut contract,
                spec("first", &key, NOW_MS),
                "direct:duplicate",
                ONE_USDC,
            )
            .0,
            0
        );
        assert_eq!(
            direct_fund(
                &mut contract,
                spec("second", &key, NOW_MS),
                "direct:duplicate",
                2 * ONE_USDC,
            )
            .0,
            2 * ONE_USDC
        );

        set_context(account("usdc.testnet"), NOW_MS);
        let invalid =
            contract.ft_on_transfer(accounts(4), U128(3 * ONE_USDC), "not-json".to_string());
        assert!(matches!(
            invalid,
            PromiseOrValue::Value(U128(value)) if value == 3 * ONE_USDC
        ));
        assert_eq!(contract.get_accounting().total_reserved.0, ONE_USDC);
    }

    #[test]
    fn direct_funding_rejects_a_late_or_overlong_quote_authorization() {
        let mut contract = contract();
        let key = signing_key(21);
        let campaign = spec("late-direct", &key, NOW_MS);
        set_context(account("usdc.testnet"), NOW_MS + 60_000);
        let late = contract.ft_on_transfer(
            accounts(4),
            U128(ONE_USDC),
            direct_msg_with_deadline(campaign.clone(), "direct:late", NOW_MS + 30_000),
        );
        assert!(matches!(late, PromiseOrValue::Value(U128(value)) if value == ONE_USDC));
        assert!(contract.get_campaign("late-direct".to_string()).is_none());

        set_context(account("usdc.testnet"), NOW_MS);
        let overlong = contract.ft_on_transfer(
            accounts(4),
            U128(ONE_USDC),
            direct_msg_with_deadline(
                campaign.clone(),
                "direct:overlong",
                campaign.expires_at_ms + 1,
            ),
        );
        assert!(matches!(
            overlong,
            PromiseOrValue::Value(U128(value)) if value == ONE_USDC
        ));
        assert_eq!(contract.get_accounting().total_reserved.0, 0);
    }

    #[test]
    fn zero_oversized_and_malformed_campaigns_are_rejected() {
        let mut contract = contract();
        let key = signing_key(3);
        assert_eq!(
            direct_fund(&mut contract, spec("zero", &key, NOW_MS), "direct:zero", 0,).0,
            0
        );
        assert!(contract.get_campaign("zero".to_string()).is_none());

        assert_eq!(
            direct_fund(
                &mut contract,
                spec("huge", &key, NOW_MS),
                "direct:huge",
                MAX_USDC_PRIZE + 1,
            )
            .0,
            MAX_USDC_PRIZE + 1
        );
        let mut malformed = spec("malformed", &key, NOW_MS);
        malformed.content_hash = Base64VecU8(vec![1; 31]);
        assert_eq!(
            direct_fund(&mut contract, malformed, "direct:malformed", ONE_USDC,).0,
            ONE_USDC
        );
        assert!(contract.get_accounting().invariant_holds);
    }

    #[test]
    fn only_pinned_usdc_can_call_receiver() {
        let mut contract = contract();
        let key = signing_key(4);
        set_context(accounts(4), NOW_MS);
        assert_panics(|| {
            contract.ft_on_transfer(
                accounts(4),
                U128(ONE_USDC),
                direct_msg(spec("wrong-token", &key, NOW_MS), "wrong-token"),
            );
        });
    }

    #[test]
    fn external_funding_requires_creator_authorization_operator_and_verified_surplus() {
        let mut contract = contract();
        let key = signing_key(5);
        let args = external_args(
            "intents",
            &key,
            NOW_MS,
            10 * ONE_USDC,
            "intents:tx-1",
            FundingRail::Intents,
            account("sponsor.testnet"),
        );

        set_context(accounts(4), NOW_MS);
        assert_panics(|| {
            contract.authorize_external_funding(args.clone());
        });

        set_context(accounts(1), NOW_MS);
        assert_panics(|| {
            contract.activate_external_funding(ExternalFundingActivationArgs {
                campaign_id: "intents".to_string(),
                funding_reference: "intents:tx-1".to_string(),
            });
        });

        let authorization = authorize_external(&mut contract, args, NOW_MS);
        assert_eq!(authorization.amount.0, 10 * ONE_USDC);
        assert_eq!(authorization.controller_id, accounts(2));
        assert_eq!(authorization.refund_account_id, accounts(2));
        assert!(authorization.storage_deposit.0 > 0);
        assert_eq!(contract.get_accounting().total_reserved.0, 0);

        set_context(accounts(4), NOW_MS);
        assert_panics(|| {
            contract.activate_external_funding(ExternalFundingActivationArgs {
                campaign_id: "intents".to_string(),
                funding_reference: "intents:tx-1".to_string(),
            });
        });

        activate_external(&mut contract, "intents", "intents:tx-1", NOW_MS);
        assert!(contract.get_campaign("intents".to_string()).is_none());
        assert_eq!(contract.get_accounting().total_reserved.0, 0);
        assert!(
            contract
                .get_external_funding_authorization("intents:tx-1".to_string())
                .unwrap()
                .pending
        );
        set_context(accounts(1), NOW_MS);
        assert_panics(|| {
            contract.activate_external_funding(ExternalFundingActivationArgs {
                campaign_id: "intents".to_string(),
                funding_reference: "intents:tx-1".to_string(),
            });
        });

        set_callback(
            PromiseResult::Successful(serde_json::to_vec(&U128(10 * ONE_USDC)).unwrap()),
            NOW_MS,
        );
        assert!(contract.on_external_funding_balance("intents:tx-1".to_string()));
        let campaign = contract.get_campaign("intents".to_string()).unwrap();
        assert_eq!(campaign.funding_rail, FundingRail::Intents);
        assert_eq!(campaign.sponsor_id, account("sponsor.testnet"));
        assert_eq!(contract.get_accounting().total_reserved.0, 10 * ONE_USDC);
        assert!(contract
            .get_external_funding_authorization("intents:tx-1".to_string())
            .is_none());
        set_context(accounts(1), NOW_MS);
        assert_panics(|| {
            contract.activate_external_funding(ExternalFundingActivationArgs {
                campaign_id: "intents".to_string(),
                funding_reference: "intents:tx-1".to_string(),
            });
        });
    }

    #[test]
    fn external_authorization_is_creator_signed_immutable_and_idempotent() {
        let mut contract = contract();
        let key = signing_key(22);
        let args = external_args(
            "authorized",
            &key,
            NOW_MS + 60_000,
            7 * ONE_USDC,
            "intents:authorized",
            FundingRail::Intents,
            account("sponsor.testnet"),
        );
        let first = authorize_external(&mut contract, args.clone(), NOW_MS);
        assert_eq!(first.amount.0, 7 * ONE_USDC);
        assert_eq!(first.funding_rail, FundingRail::Intents);
        assert_eq!(first.sponsor_id, account("sponsor.testnet"));
        assert_eq!(first.opens_at_ms, NOW_MS + 60_000);
        assert_eq!(first.content_hash.0, vec![9; 32]);
        assert_eq!(
            first.solution_public_key.0,
            key.verifying_key().to_bytes().to_vec()
        );

        set_context_with_deposit(accounts(2), NOW_MS + 60_001, NearToken::from_yoctonear(1));
        let duplicate = contract.authorize_external_funding(args.clone());
        assert_eq!(duplicate.storage_deposit, first.storage_deposit);

        let mut changed = args.clone();
        changed.amount = U128(8 * ONE_USDC);
        set_context_with_deposit(accounts(2), NOW_MS, NearToken::from_near(1));
        assert_panics(|| {
            contract.authorize_external_funding(changed);
        });

        set_context(accounts(1), NOW_MS);
        assert_panics(|| {
            contract.activate_external_funding(ExternalFundingActivationArgs {
                campaign_id: "substituted".to_string(),
                funding_reference: "intents:authorized".to_string(),
            });
        });
        assert_eq!(contract.get_accounting().total_reserved.0, 0);
    }

    #[test]
    fn external_authorization_rejects_expired_or_overlong_funding_deadlines() {
        let key = signing_key(31);
        let mut expired_contract = contract();
        set_context_with_deposit(accounts(2), NOW_MS, NearToken::from_near(1));
        assert_panics(|| {
            expired_contract.authorize_external_funding(external_args_with_deadline(
                "expired-deadline",
                &key,
                NOW_MS,
                ONE_USDC,
                "intents:expired-deadline",
                FundingRail::Intents,
                accounts(4),
                NOW_MS,
            ));
        });

        let mut overlong_contract = contract();
        let mut overlong = external_args(
            "overlong-deadline",
            &key,
            NOW_MS,
            ONE_USDC,
            "intents:overlong-deadline",
            FundingRail::Intents,
            accounts(4),
        );
        overlong.funding_deadline_ms = overlong.campaign.expires_at_ms + 1;
        set_context_with_deposit(accounts(2), NOW_MS, NearToken::from_near(1));
        assert_panics(|| {
            overlong_contract.authorize_external_funding(overlong);
        });
    }

    #[test]
    fn operator_and_mismatched_roles_cannot_authorize_external_funding() {
        let key = signing_key(23);
        let mut operator_contract = contract();
        let mut operator_args = external_args(
            "operator-auth",
            &key,
            NOW_MS,
            ONE_USDC,
            "intents:operator-auth",
            FundingRail::Intents,
            accounts(1),
        );
        operator_args.campaign.creator_id = accounts(1);
        operator_args.campaign.controller_id = Some(accounts(1));
        operator_args.campaign.refund_account_id = accounts(1);
        set_context_with_deposit(accounts(1), NOW_MS, NearToken::from_near(1));
        assert_panics(|| {
            operator_contract.authorize_external_funding(operator_args);
        });

        let mut role_contract = contract();
        let mismatched = ExternalFundingArgs {
            campaign: spec("mismatched-role", &key, NOW_MS),
            amount: U128(ONE_USDC),
            funding_reference: "intents:mismatched-role".to_string(),
            funding_rail: FundingRail::Intents,
            sponsor_id: accounts(4),
            funding_deadline_ms: NOW_MS + 5 * 60 * 1_000,
        };
        set_context_with_deposit(accounts(2), NOW_MS, NearToken::from_near(1));
        assert_panics(|| {
            role_contract.authorize_external_funding(mismatched);
        });

        let mut storage_contract = contract();
        let storage_args = external_args(
            "storage",
            &key,
            NOW_MS,
            ONE_USDC,
            "intents:storage",
            FundingRail::Intents,
            accounts(4),
        );
        set_context_with_deposit(accounts(2), NOW_MS, NearToken::from_yoctonear(1));
        assert_panics(|| {
            storage_contract.authorize_external_funding(storage_args);
        });
    }

    #[test]
    fn allocation_started_by_deadline_may_finalize_late_and_remains_refundable() {
        let mut contract = contract();
        let key = signing_key(24);
        let mut args = external_args(
            "late-external",
            &key,
            NOW_MS,
            3 * ONE_USDC,
            "intents:late-external",
            FundingRail::Intents,
            accounts(4),
        );
        let expires_at_ms = args.campaign.expires_at_ms;
        args.funding_deadline_ms = expires_at_ms;
        authorize_external(&mut contract, args, NOW_MS);
        activate_external(
            &mut contract,
            "late-external",
            "intents:late-external",
            expires_at_ms,
        );
        set_callback(
            PromiseResult::Successful(serde_json::to_vec(&U128(3 * ONE_USDC)).unwrap()),
            expires_at_ms + 1,
        );
        assert!(contract.on_external_funding_balance("intents:late-external".to_string()));
        assert_eq!(contract.get_accounting().total_reserved.0, 3 * ONE_USDC);
        assert!(matches!(
            contract
                .get_campaign("late-external".to_string())
                .unwrap()
                .status,
            CampaignStatusView::Active
        ));

        set_context(accounts(5), expires_at_ms + 2);
        contract.expire_and_refund("late-external".to_string());
        set_callback(PromiseResult::Successful(vec![]), expires_at_ms + 3);
        assert!(contract.on_refund_transfer("late-external".to_string(), 0));
        assert_eq!(contract.get_accounting().total_reserved.0, 0);
    }

    #[test]
    fn expired_authorization_cleanup_releases_campaign_but_retires_reference() {
        let mut contract = contract();
        let key = signing_key(26);
        let deadline = NOW_MS + 1_000;
        let authorization = authorize_external(
            &mut contract,
            external_args_with_deadline(
                "stale",
                &key,
                NOW_MS,
                ONE_USDC,
                "intents:stale",
                FundingRail::Intents,
                accounts(4),
                deadline,
            ),
            NOW_MS,
        );
        assert_eq!(authorization.funding_deadline_ms, deadline);
        assert!(!authorization.expired);

        set_context(accounts(5), deadline);
        assert_panics(|| {
            contract.cleanup_expired_external_funding_authorization("intents:stale".to_string());
        });

        set_context(accounts(5), deadline + 1);
        let storage_before = env::storage_usage();
        let removed =
            contract.cleanup_expired_external_funding_authorization("intents:stale".to_string());
        let storage_after = env::storage_usage();
        assert_eq!(removed.campaign_id, "stale");
        assert_eq!(removed.funding_reference, "intents:stale");
        assert!(removed.storage_refund.0 > 0);
        assert!(removed.storage_refund.0 < authorization.storage_deposit.0);
        assert_eq!(
            removed.storage_refund.0,
            u128::from(storage_before - storage_after) * env::storage_byte_cost().as_yoctonear()
        );
        assert!(contract
            .get_external_funding_authorization("intents:stale".to_string())
            .is_none());
        assert!(contract.is_funding_reference_used("intents:stale".to_string()));

        set_context(accounts(1), deadline + 2);
        assert_panics(|| {
            contract.activate_external_funding(ExternalFundingActivationArgs {
                campaign_id: "stale".to_string(),
                funding_reference: "intents:stale".to_string(),
            });
        });

        set_context(account("usdc.testnet"), deadline + 2);
        let funded = contract.ft_on_transfer(
            accounts(4),
            U128(ONE_USDC),
            direct_msg_with_deadline(
                spec("stale", &key, NOW_MS),
                "direct:stale-replacement",
                deadline + 60_000,
            ),
        );
        assert!(matches!(funded, PromiseOrValue::Value(U128(0))));
        assert!(contract.get_campaign("stale".to_string()).is_some());

        set_context(account("usdc.testnet"), deadline + 2);
        let retired_reference = contract.ft_on_transfer(
            accounts(4),
            U128(ONE_USDC),
            direct_msg_with_deadline(
                spec("different", &key, NOW_MS),
                "intents:stale",
                deadline + 60_000,
            ),
        );
        assert!(matches!(
            retired_reference,
            PromiseOrValue::Value(U128(value)) if value == ONE_USDC
        ));
    }

    #[test]
    fn only_creator_can_revoke_and_revoked_terms_cannot_be_allocated() {
        let mut contract = contract();
        let key = signing_key(27);
        let authorization = authorize_external(
            &mut contract,
            external_args(
                "revoked",
                &key,
                NOW_MS,
                2 * ONE_USDC,
                "intents:revoked",
                FundingRail::Intents,
                accounts(4),
            ),
            NOW_MS,
        );

        set_context(accounts(5), NOW_MS + 1);
        assert_panics(|| {
            contract.revoke_external_funding_authorization("intents:revoked".to_string());
        });
        assert!(contract
            .get_external_funding_authorization("intents:revoked".to_string())
            .is_some());

        set_context(accounts(2), NOW_MS + 2);
        let removed = contract.revoke_external_funding_authorization("intents:revoked".to_string());
        assert_eq!(removed.campaign_id, "revoked");
        assert!(removed.storage_refund.0 > 0);
        assert!(removed.storage_refund.0 < authorization.storage_deposit.0);
        assert!(contract.is_funding_reference_used("intents:revoked".to_string()));
        assert_eq!(contract.get_accounting().total_reserved.0, 0);

        set_context(accounts(1), NOW_MS + 3);
        assert_panics(|| {
            contract.activate_external_funding(ExternalFundingActivationArgs {
                campaign_id: "revoked".to_string(),
                funding_reference: "intents:revoked".to_string(),
            });
        });
        set_callback(
            PromiseResult::Successful(serde_json::to_vec(&U128(2 * ONE_USDC)).unwrap()),
            NOW_MS + 4,
        );
        assert!(!contract.on_external_funding_balance("intents:revoked".to_string()));
        assert!(contract.get_campaign("revoked".to_string()).is_none());
    }

    #[test]
    fn expired_authorization_is_atomically_replaced_with_new_terms() {
        let mut contract = contract();
        let key = signing_key(28);
        let old_deadline = NOW_MS + 1_000;
        authorize_external(
            &mut contract,
            external_args_with_deadline(
                "replaceable",
                &key,
                NOW_MS,
                ONE_USDC,
                "intents:old",
                FundingRail::Intents,
                accounts(4),
                old_deadline,
            ),
            NOW_MS,
        );

        let new_deadline = NOW_MS + 120_000;
        let replacement = authorize_external(
            &mut contract,
            external_args_with_deadline(
                "replaceable",
                &key,
                NOW_MS,
                2 * ONE_USDC,
                "intents:new",
                FundingRail::Intents,
                accounts(5),
                new_deadline,
            ),
            old_deadline + 1,
        );
        assert_eq!(replacement.amount.0, 2 * ONE_USDC);
        assert_eq!(replacement.sponsor_id, accounts(5));
        assert_eq!(replacement.funding_deadline_ms, new_deadline);
        assert!(contract
            .get_external_funding_authorization("intents:old".to_string())
            .is_none());
        assert!(contract.is_funding_reference_used("intents:old".to_string()));
        assert!(contract
            .get_external_funding_authorization("intents:new".to_string())
            .is_some());

        set_context(accounts(1), old_deadline + 2);
        assert_panics(|| {
            contract.activate_external_funding(ExternalFundingActivationArgs {
                campaign_id: "replaceable".to_string(),
                funding_reference: "intents:old".to_string(),
            });
        });
        activate_external(
            &mut contract,
            "replaceable",
            "intents:new",
            old_deadline + 2,
        );
        set_callback(
            PromiseResult::Successful(serde_json::to_vec(&U128(2 * ONE_USDC)).unwrap()),
            old_deadline + 3,
        );
        assert!(contract.on_external_funding_balance("intents:new".to_string()));
        let campaign = contract.get_campaign("replaceable".to_string()).unwrap();
        assert_eq!(campaign.amount.0, 2 * ONE_USDC);
        assert_eq!(campaign.sponsor_id, accounts(5));
    }

    #[test]
    fn pending_allocation_locks_revoke_and_replacement_until_callback() {
        let mut contract = contract();
        let key = signing_key(29);
        let deadline = NOW_MS + 1_000;
        authorize_external(
            &mut contract,
            external_args_with_deadline(
                "race",
                &key,
                NOW_MS,
                4 * ONE_USDC,
                "intents:race-old",
                FundingRail::Intents,
                accounts(4),
                deadline,
            ),
            NOW_MS,
        );
        activate_external(&mut contract, "race", "intents:race-old", deadline);

        set_context(accounts(2), deadline + 1);
        assert_panics(|| {
            contract.revoke_external_funding_authorization("intents:race-old".to_string());
        });
        set_context_with_deposit(accounts(2), deadline + 1, NearToken::from_near(1));
        assert_panics(|| {
            contract.authorize_external_funding(external_args_with_deadline(
                "race",
                &key,
                NOW_MS,
                5 * ONE_USDC,
                "intents:race-new",
                FundingRail::Intents,
                accounts(5),
                deadline + 120_000,
            ));
        });
        assert!(contract
            .get_external_funding_authorization("intents:race-new".to_string())
            .is_none());

        set_callback(
            PromiseResult::Successful(serde_json::to_vec(&U128(4 * ONE_USDC)).unwrap()),
            deadline + 2,
        );
        assert!(contract.on_external_funding_balance("intents:race-old".to_string()));
        let campaign = contract.get_campaign("race".to_string()).unwrap();
        assert_eq!(campaign.amount.0, 4 * ONE_USDC);
        assert_eq!(campaign.sponsor_id, accounts(4));
    }

    #[test]
    fn failed_pending_check_after_deadline_releases_authorization_for_replacement() {
        let mut contract = contract();
        let key = signing_key(32);
        let deadline = NOW_MS + 1_000;
        authorize_external(
            &mut contract,
            external_args_with_deadline(
                "failed-race",
                &key,
                NOW_MS,
                ONE_USDC,
                "intents:failed-race-old",
                FundingRail::Intents,
                accounts(4),
                deadline,
            ),
            NOW_MS,
        );
        activate_external(
            &mut contract,
            "failed-race",
            "intents:failed-race-old",
            deadline,
        );
        set_callback(PromiseResult::Failed, deadline + 1);
        assert!(!contract.on_external_funding_balance("intents:failed-race-old".to_string()));
        let expired = contract
            .get_external_funding_authorization("intents:failed-race-old".to_string())
            .unwrap();
        assert!(expired.expired);
        assert!(!expired.pending);

        let replacement = authorize_external(
            &mut contract,
            external_args_with_deadline(
                "failed-race",
                &key,
                NOW_MS,
                2 * ONE_USDC,
                "intents:failed-race-new",
                FundingRail::Intents,
                accounts(5),
                deadline + 120_000,
            ),
            deadline + 2,
        );
        assert_eq!(replacement.amount.0, 2 * ONE_USDC);
        assert!(contract.is_funding_reference_used("intents:failed-race-old".to_string()));
    }

    #[test]
    fn expired_unstarted_authorization_rejects_late_operator_allocation() {
        let mut contract = contract();
        let key = signing_key(30);
        let deadline = NOW_MS + 1_000;
        authorize_external(
            &mut contract,
            external_args_with_deadline(
                "too-late",
                &key,
                NOW_MS,
                ONE_USDC,
                "intents:too-late",
                FundingRail::Intents,
                accounts(4),
                deadline,
            ),
            NOW_MS,
        );

        set_context(accounts(1), deadline + 1);
        assert_panics(|| {
            contract.activate_external_funding(ExternalFundingActivationArgs {
                campaign_id: "too-late".to_string(),
                funding_reference: "intents:too-late".to_string(),
            });
        });
        let view = contract
            .get_external_funding_authorization("intents:too-late".to_string())
            .unwrap();
        assert!(view.expired);
        assert!(!view.pending);
        assert_eq!(contract.get_accounting().total_reserved.0, 0);
    }

    #[test]
    fn concurrent_external_allocations_cannot_reserve_same_balance_twice() {
        let mut contract = contract();
        let key = signing_key(6);
        for (id, reference) in [("one", "intents:one"), ("two", "intents:two")] {
            authorize_external(
                &mut contract,
                external_args(
                    id,
                    &key,
                    NOW_MS,
                    10 * ONE_USDC,
                    reference,
                    FundingRail::Intents,
                    accounts(4),
                ),
                NOW_MS,
            );
            activate_external(&mut contract, id, reference, NOW_MS);
        }

        let balance_bytes = serde_json::to_vec(&U128(10 * ONE_USDC)).unwrap();
        set_callback(PromiseResult::Successful(balance_bytes.clone()), NOW_MS);
        assert!(contract.on_external_funding_balance("intents:one".to_string()));
        set_callback(PromiseResult::Successful(balance_bytes), NOW_MS);
        assert!(!contract.on_external_funding_balance("intents:two".to_string()));
        assert!(contract.get_campaign("one".to_string()).is_some());
        assert!(contract.get_campaign("two".to_string()).is_none());
        assert!(!contract.is_funding_reference_used("intents:two".to_string()));
        assert!(contract
            .get_external_funding_authorization("intents:two".to_string())
            .is_some());
        assert!(contract.get_accounting().invariant_holds);
    }

    #[test]
    fn direct_funding_cannot_race_an_external_authorization() {
        let mut contract = contract();
        let key = signing_key(25);
        authorize_external(
            &mut contract,
            external_args(
                "reserved",
                &key,
                NOW_MS,
                ONE_USDC,
                "intents:reserved",
                FundingRail::Intents,
                accounts(4),
            ),
            NOW_MS,
        );
        assert_eq!(
            direct_fund(
                &mut contract,
                spec("reserved", &key, NOW_MS),
                "direct:other",
                ONE_USDC,
            )
            .0,
            ONE_USDC
        );
        assert_eq!(
            direct_fund(
                &mut contract,
                spec("other", &key, NOW_MS),
                "intents:reserved",
                ONE_USDC,
            )
            .0,
            ONE_USDC
        );
        assert!(contract
            .get_external_funding_authorization("intents:reserved".to_string())
            .is_some());
        assert_eq!(contract.get_accounting().total_reserved.0, 0);
    }

    #[test]
    fn failed_external_balance_query_releases_reference_and_campaign_id() {
        let mut contract = contract();
        let key = signing_key(7);
        let args = external_args(
            "retry",
            &key,
            NOW_MS,
            ONE_USDC,
            "x402:retry",
            FundingRail::X402,
            accounts(4),
        );
        authorize_external(&mut contract, args.clone(), NOW_MS);
        activate_external(&mut contract, "retry", "x402:retry", NOW_MS);
        set_callback(PromiseResult::Failed, NOW_MS);
        assert!(!contract.on_external_funding_balance("x402:retry".to_string()));
        let authorization = contract
            .get_external_funding_authorization("x402:retry".to_string())
            .unwrap();
        assert!(!authorization.pending);
        assert_eq!(contract.get_accounting().total_reserved.0, 0);

        set_context_with_deposit(accounts(2), NOW_MS, NearToken::from_yoctonear(1));
        contract.authorize_external_funding(args);
        activate_external(&mut contract, "retry", "x402:retry", NOW_MS);
    }

    #[test]
    fn valid_claim_binds_destination_and_finalizes_once() {
        let mut contract = contract();
        let key = signing_key(8);
        direct_fund(
            &mut contract,
            spec("winner", &key, NOW_MS),
            "direct:winner",
            12 * ONE_USDC,
        );
        set_context(accounts(4), NOW_MS + 1);
        let args = claim_args(
            &contract,
            &key,
            "winner",
            account("winner.testnet"),
            [22; 32],
            0,
            NOW_MS + 60_000,
        );
        contract.claim(args.clone());

        let pending = contract.get_campaign("winner".to_string()).unwrap();
        assert_eq!(pending.claim_nonce, 1);
        assert!(matches!(
            pending.status,
            CampaignStatusView::Claiming { .. }
        ));
        assert_panics(|| {
            contract.claim(args.clone());
        });

        set_callback(PromiseResult::Successful(vec![]), NOW_MS + 2);
        assert!(contract.on_claim_transfer("winner".to_string(), 0));
        assert!(matches!(
            contract.get_campaign("winner".to_string()).unwrap().status,
            CampaignStatusView::Claimed { .. }
        ));
        assert_eq!(contract.get_accounting().total_reserved.0, 0);

        set_context(accounts(4), NOW_MS + 3);
        assert_panics(|| {
            contract.claim(args);
        });
    }

    #[test]
    fn recipient_substitution_and_bad_signature_are_rejected() {
        let mut contract = contract();
        let key = signing_key(9);
        direct_fund(
            &mut contract,
            spec("bound", &key, NOW_MS),
            "direct:bound",
            ONE_USDC,
        );
        set_context(accounts(4), NOW_MS + 1);
        let mut args = claim_args(
            &contract,
            &key,
            "bound",
            account("winner.testnet"),
            [33; 32],
            0,
            NOW_MS + 60_000,
        );
        args.receiver_id = account("attacker.testnet");
        assert_panics(|| {
            contract.claim(args);
        });

        let wrong_key = signing_key(10);
        let args = claim_args(
            &contract,
            &wrong_key,
            "bound",
            account("winner.testnet"),
            [33; 32],
            0,
            NOW_MS + 60_000,
        );
        assert_panics(|| {
            contract.claim(args);
        });
        assert_eq!(
            contract
                .get_campaign("bound".to_string())
                .unwrap()
                .claim_nonce,
            0
        );
    }

    #[test]
    fn failed_claim_reopens_with_consumed_nonce() {
        let mut contract = contract();
        let key = signing_key(11);
        direct_fund(
            &mut contract,
            spec("retry-claim", &key, NOW_MS),
            "direct:retry-claim",
            4 * ONE_USDC,
        );
        set_context(accounts(4), NOW_MS + 1);
        let old_args = claim_args(
            &contract,
            &key,
            "retry-claim",
            accounts(5),
            [44; 32],
            0,
            NOW_MS + 120_000,
        );
        contract.claim(old_args.clone());
        set_callback(PromiseResult::Failed, NOW_MS + 2);
        assert!(!contract.on_claim_transfer("retry-claim".to_string(), 0));

        let campaign = contract.get_campaign("retry-claim".to_string()).unwrap();
        assert_eq!(campaign.claim_nonce, 1);
        assert!(matches!(campaign.status, CampaignStatusView::Active));
        assert_eq!(contract.get_accounting().total_reserved.0, 4 * ONE_USDC);

        set_context(accounts(4), NOW_MS + 3);
        assert_panics(|| {
            contract.claim(old_args);
        });
        let new_args = claim_args(
            &contract,
            &key,
            "retry-claim",
            accounts(5),
            [44; 32],
            1,
            NOW_MS + 120_000,
        );
        contract.claim(new_args);
    }

    #[test]
    fn scheduled_campaign_opens_by_time_and_enforces_deadlines() {
        let mut contract = contract();
        let key = signing_key(12);
        let open = NOW_MS + 60_000;
        direct_fund(
            &mut contract,
            spec("scheduled", &key, open),
            "direct:scheduled",
            ONE_USDC,
        );
        assert!(matches!(
            contract
                .get_campaign("scheduled".to_string())
                .unwrap()
                .status,
            CampaignStatusView::Scheduled
        ));

        set_context(accounts(4), NOW_MS + 1);
        let early = claim_args(
            &contract,
            &key,
            "scheduled",
            accounts(5),
            [55; 32],
            0,
            open + 60_000,
        );
        assert_panics(|| {
            contract.claim(early);
        });

        set_context(accounts(4), open);
        assert!(matches!(
            contract
                .get_campaign("scheduled".to_string())
                .unwrap()
                .status,
            CampaignStatusView::Active
        ));
        let expired_permit = claim_args(
            &contract,
            &key,
            "scheduled",
            accounts(5),
            [55; 32],
            0,
            open - 1,
        );
        assert_panics(|| {
            contract.claim(expired_permit);
        });
    }

    #[test]
    fn creator_can_cancel_before_open_and_retry_failed_refund() {
        let mut contract = contract();
        let key = signing_key(13);
        direct_fund(
            &mut contract,
            spec("cancel", &key, NOW_MS + 60_000),
            "direct:cancel",
            8 * ONE_USDC,
        );
        set_context(accounts(2), NOW_MS + 1);
        contract.cancel_before_open("cancel".to_string());
        assert!(matches!(
            contract.get_campaign("cancel".to_string()).unwrap().status,
            CampaignStatusView::Refunding {
                attempt: 0,
                in_flight: true,
                ..
            }
        ));

        set_context(accounts(5), NOW_MS + 2);
        assert_panics(|| {
            contract.retry_refund("cancel".to_string());
        });
        set_callback(PromiseResult::Failed, NOW_MS + 2);
        assert!(!contract.on_refund_transfer("cancel".to_string(), 0));
        assert_eq!(contract.get_accounting().total_reserved.0, 8 * ONE_USDC);
        assert!(matches!(
            contract.get_campaign("cancel".to_string()).unwrap().status,
            CampaignStatusView::Refunding {
                attempt: 0,
                in_flight: false,
                ..
            }
        ));

        set_context(accounts(5), NOW_MS + 3);
        contract.retry_refund("cancel".to_string());
        assert!(matches!(
            contract.get_campaign("cancel".to_string()).unwrap().status,
            CampaignStatusView::Refunding {
                attempt: 1,
                in_flight: true,
                ..
            }
        ));

        set_callback(PromiseResult::Successful(vec![]), NOW_MS + 4);
        assert!(contract.on_refund_transfer("cancel".to_string(), 1));
        assert!(matches!(
            contract.get_campaign("cancel".to_string()).unwrap().status,
            CampaignStatusView::Refunded { .. }
        ));
        assert_eq!(contract.get_accounting().total_reserved.0, 0);
    }

    #[test]
    fn contract_operator_can_relay_creator_cancellation() {
        let mut contract = contract();
        let key = signing_key(20);
        direct_fund(
            &mut contract,
            spec("operator-cancel", &key, NOW_MS + 60_000),
            "direct:operator-cancel",
            ONE_USDC,
        );
        set_context(accounts(1), NOW_MS + 1);
        contract.cancel_before_open("operator-cancel".to_string());
        assert!(matches!(
            contract
                .get_campaign("operator-cancel".to_string())
                .unwrap()
                .status,
            CampaignStatusView::Refunding {
                attempt: 0,
                in_flight: true,
                ..
            }
        ));
    }

    #[test]
    fn unauthorized_or_late_cancellation_is_rejected() {
        let mut contract = contract();
        let key = signing_key(14);
        direct_fund(
            &mut contract,
            spec("protected", &key, NOW_MS + 60_000),
            "direct:protected",
            ONE_USDC,
        );
        set_context(accounts(4), NOW_MS + 1);
        assert_panics(|| {
            contract.cancel_before_open("protected".to_string());
        });

        set_context(accounts(2), NOW_MS + 60_000);
        assert_panics(|| {
            contract.cancel_before_open("protected".to_string());
        });
    }

    #[test]
    fn expiry_refund_is_permissionless_and_double_refund_is_blocked() {
        let mut contract = contract();
        let key = signing_key(15);
        let mut campaign_spec = spec("expired", &key, NOW_MS);
        campaign_spec.expires_at_ms = NOW_MS + MIN_CAMPAIGN_DURATION_MS;
        direct_fund(&mut contract, campaign_spec, "direct:expired", 5 * ONE_USDC);

        set_context(accounts(5), NOW_MS + MIN_CAMPAIGN_DURATION_MS);
        contract.expire_and_refund("expired".to_string());
        assert_panics(|| {
            contract.expire_and_refund("expired".to_string());
        });
        set_callback(
            PromiseResult::Successful(vec![]),
            NOW_MS + MIN_CAMPAIGN_DURATION_MS + 1,
        );
        assert!(contract.on_refund_transfer("expired".to_string(), 0));

        set_context(accounts(5), NOW_MS + MIN_CAMPAIGN_DURATION_MS + 2);
        assert_panics(|| {
            contract.expire_and_refund("expired".to_string());
        });
        assert_eq!(contract.get_accounting().total_reserved.0, 0);
    }

    #[test]
    fn stale_callbacks_cannot_mutate_newer_attempts() {
        let mut contract = contract();
        let key = signing_key(16);
        direct_fund(
            &mut contract,
            spec("stale", &key, NOW_MS + 60_000),
            "direct:stale",
            ONE_USDC,
        );
        set_context(accounts(2), NOW_MS + 1);
        contract.cancel_before_open("stale".to_string());
        set_callback(PromiseResult::Failed, NOW_MS + 2);
        contract.on_refund_transfer("stale".to_string(), 0);
        set_context(accounts(5), NOW_MS + 3);
        contract.retry_refund("stale".to_string());

        set_callback(PromiseResult::Successful(vec![]), NOW_MS + 4);
        assert!(!contract.on_refund_transfer("stale".to_string(), 0));
        assert_eq!(contract.get_accounting().total_reserved.0, ONE_USDC);
        assert!(contract.on_refund_transfer("stale".to_string(), 1));
        assert_eq!(contract.get_accounting().total_reserved.0, 0);
    }

    #[test]
    fn accounting_invariant_survives_mixed_terminal_states() {
        let mut contract = contract();
        let key_a = signing_key(17);
        let key_b = signing_key(18);
        let key_c = signing_key(19);
        direct_fund(
            &mut contract,
            spec("claimed", &key_a, NOW_MS),
            "direct:claimed",
            ONE_USDC,
        );
        direct_fund(
            &mut contract,
            spec("refunded", &key_b, NOW_MS + 60_000),
            "direct:refunded",
            2 * ONE_USDC,
        );
        direct_fund(
            &mut contract,
            spec("live", &key_c, NOW_MS),
            "direct:live",
            3 * ONE_USDC,
        );

        set_context(accounts(4), NOW_MS + 1);
        let args = claim_args(
            &contract,
            &key_a,
            "claimed",
            accounts(5),
            [66; 32],
            0,
            NOW_MS + 30_000,
        );
        contract.claim(args);
        set_callback(PromiseResult::Successful(vec![]), NOW_MS + 2);
        contract.on_claim_transfer("claimed".to_string(), 0);

        set_context(accounts(2), NOW_MS + 3);
        contract.cancel_before_open("refunded".to_string());
        set_callback(PromiseResult::Successful(vec![]), NOW_MS + 4);
        contract.on_refund_transfer("refunded".to_string(), 0);

        let accounting = contract.get_accounting();
        assert!(accounting.invariant_holds);
        assert_eq!(accounting.total_reserved.0, 3 * ONE_USDC);
        assert_eq!(accounting.computed_liabilities.0, 3 * ONE_USDC);
        assert!(get_logs().iter().any(|log| log.starts_with("EVENT_JSON:")));
    }

    #[test]
    fn checked_in_claim_fixture_matches_contract_encoding_and_ed25519() {
        #[derive(Deserialize)]
        #[serde(crate = "near_sdk::serde")]
        struct Fixture {
            contract_id: String,
            campaign_id: String,
            receiver_id: String,
            nonce: u64,
            deadline_ms: u64,
            seed_base64: String,
            solution_public_key_base64: String,
            payout_digest_base64: String,
            claim_message_base64: String,
            signature_base64: String,
        }

        let fixture: Fixture =
            serde_json::from_str(include_str!("../fixtures/claim-permit-v1.json")).unwrap();
        let seed: [u8; 32] = BASE64
            .decode(fixture.seed_base64)
            .unwrap()
            .try_into()
            .unwrap();
        let signing_key = SigningKey::from_bytes(&seed);
        assert_eq!(
            BASE64.encode(signing_key.verifying_key().to_bytes()),
            fixture.solution_public_key_base64
        );

        let digest: [u8; 32] = BASE64
            .decode(fixture.payout_digest_base64)
            .unwrap()
            .try_into()
            .unwrap();
        let message = CrosswordCampaigns::claim_message_bytes(
            &fixture.contract_id.parse().unwrap(),
            &fixture.campaign_id,
            &fixture.receiver_id.parse().unwrap(),
            &digest,
            fixture.nonce,
            fixture.deadline_ms,
        );
        assert_eq!(BASE64.encode(&message), fixture.claim_message_base64);
        assert_eq!(
            BASE64.encode(signing_key.sign(&message).to_bytes()),
            fixture.signature_base64
        );
    }
}
