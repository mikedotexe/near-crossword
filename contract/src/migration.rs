use crate::*;
use near_sdk::collections::LookupMap;

/// Old contract state matching current on-chain layout (near-sdk 3.1.0).
/// Storage prefixes b"c" and b"u" are baked into on-chain state.
#[derive(BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct OldCrossword {
    puzzles: LookupMap<PublicKey, Puzzle>,
    unsolved_puzzles: UnorderedSet<PublicKey>,
    creator_account: AccountId,
}

#[near]
impl Crossword {
    /// Migrate from the old 3-field struct to the new struct with owner/operator/reservations.
    /// Call this exactly once after deploying the upgraded contract.
    #[private]
    #[init(ignore_state)]
    pub fn migrate(owner_id: AccountId, operator_id: Option<AccountId>) -> Self {
        let old: OldCrossword = env::state_read().expect("Failed to read old state");

        log!(
            "Migrating contract: creator_account={}",
            old.creator_account
        );

        Self {
            puzzles: old.puzzles,
            unsolved_puzzles: old.unsolved_puzzles,
            creator_account: old.creator_account,
            owner_id: owner_id.clone(),
            operator_id: operator_id.unwrap_or(owner_id),
            reserved_puzzles: LookupMap::new(b"r"),
        }
    }
}
