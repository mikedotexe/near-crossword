mod admin;
mod debugging;
mod migration;
mod reservation;

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedSet};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json;
use near_sdk::{
    env, ext_contract, log, near, AccountId, Allowance, Gas, NearToken, PanicOnDefault, Promise,
    PublicKey,
};

pub type Balance = u128;

const GAS_FOR_ACCOUNT_CREATION: Gas = Gas::from_tgas(150);
const GAS_FOR_ACCOUNT_CALLBACK: Gas = Gas::from_tgas(110);

#[ext_contract(ext_linkdrop)]
pub trait ExtLinkDropCrossContract {
    fn create_account(&mut self, new_account_id: AccountId, new_public_key: PublicKey) -> Promise;
}

#[ext_contract(ext_self)]
pub trait AfterClaim {
    fn callback_after_transfer(
        &mut self,
        crossword_pk: PublicKey,
        account_id: String,
        memo: String,
        signer_pk: PublicKey,
    ) -> bool;
    fn callback_after_create_account(
        &mut self,
        crossword_pk: PublicKey,
        account_id: String,
        memo: String,
        signer_pk: PublicKey,
    ) -> bool;
}

#[derive(BorshDeserialize, BorshSerialize, Deserialize, Serialize, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum AnswerDirection {
    Across,
    Down,
}

#[derive(BorshDeserialize, BorshSerialize, Deserialize, Serialize, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct CoordinatePair {
    x: u8,
    y: u8,
}

#[derive(BorshDeserialize, BorshSerialize, Deserialize, Serialize, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Answer {
    num: u8,
    start: CoordinatePair,
    direction: AnswerDirection,
    length: u8,
    clue: String,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Debug)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum PuzzleStatus {
    Unsolved,
    Solved { solver_pk: PublicKey },
    Claimed { memo: String },
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct UnsolvedPuzzles {
    puzzles: Vec<JsonPuzzle>,
    creator_account: AccountId,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct JsonPuzzle {
    solution_public_key: String,
    status: PuzzleStatus,
    reward: Balance,
    creator: AccountId,
    dimensions: CoordinatePair,
    answer: Vec<Answer>,
}

#[derive(BorshDeserialize, BorshSerialize, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Puzzle {
    status: PuzzleStatus,
    reward: Balance,
    creator: AccountId,
    dimensions: CoordinatePair,
    answer: Vec<Answer>,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Crossword {
    puzzles: LookupMap<PublicKey, Puzzle>,
    unsolved_puzzles: UnorderedSet<PublicKey>,
    creator_account: AccountId,
    // New fields added in migration
    owner_id: AccountId,
    operator_id: AccountId,
    reserved_puzzles: LookupMap<String, reservation::ReservedPuzzle>,
}

#[near]
impl Crossword {
    #[init]
    pub fn new(
        creator_account: AccountId,
        owner_id: AccountId,
        operator_id: Option<AccountId>,
    ) -> Self {
        Self {
            puzzles: LookupMap::new(b"c"),
            unsolved_puzzles: UnorderedSet::new(b"u"),
            creator_account,
            owner_id: owner_id.clone(),
            operator_id: operator_id.unwrap_or(owner_id),
            reserved_puzzles: LookupMap::new(b"r"),
        }
    }

    pub fn submit_solution(&mut self, solver_pk: PublicKey) {
        let answer_pk = env::signer_account_pk();
        let mut puzzle = self
            .puzzles
            .get(&answer_pk)
            .expect("ERR_NOT_CORRECT_ANSWER");

        puzzle.status = match puzzle.status {
            PuzzleStatus::Unsolved => PuzzleStatus::Solved {
                solver_pk: solver_pk.clone(),
            },
            _ => {
                env::panic_str("ERR_PUZZLE_SOLVED");
            }
        };

        self.puzzles.insert(&answer_pk, &puzzle);
        self.unsolved_puzzles.remove(&answer_pk);

        log!(
            "Puzzle with pk {:?} solved, solver pk: {:?}",
            answer_pk,
            solver_pk
        );

        Promise::new(env::current_account_id())
            .add_access_key_allowance(
                solver_pk,
                Allowance::limited(NearToken::from_millinear(250)).unwrap(),
                env::current_account_id(),
                "claim_reward,claim_reward_new_account".to_string(),
            )
            .then(Promise::new(env::current_account_id()).delete_key(answer_pk))
            .detach();
    }

    pub fn claim_reward_new_account(
        &mut self,
        crossword_pk: PublicKey,
        new_acc_id: AccountId,
        new_pk: PublicKey,
        memo: String,
    ) -> Promise {
        let signer_pk = env::signer_account_pk();
        let puzzle = self
            .puzzles
            .get(&crossword_pk)
            .expect("Not a correct public key to solve puzzle");

        match puzzle.status {
            PuzzleStatus::Solved {
                solver_pk: ref puzzle_pk,
            } => {
                assert_eq!(signer_pk, *puzzle_pk, "You're not the person who can claim this, or else you need to use your function-call access key, friend.");
            }
            _ => {
                env::panic_str("puzzle should have `Solved` status to be claimed");
            }
        };

        let reward_amount = puzzle.reward;
        assert!(
            env::account_balance().as_yoctonear() >= reward_amount,
            "The smart contract does not have enough balance to pay this out. :/"
        );

        ext_linkdrop::ext(self.creator_account.clone())
            .with_attached_deposit(NearToken::from_yoctonear(reward_amount))
            .with_static_gas(GAS_FOR_ACCOUNT_CREATION)
            .create_account(new_acc_id.clone(), new_pk)
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ACCOUNT_CALLBACK)
                    .callback_after_create_account(
                        crossword_pk,
                        new_acc_id.to_string(),
                        memo,
                        env::signer_account_pk(),
                    ),
            )
    }

    pub fn claim_reward(
        &mut self,
        crossword_pk: PublicKey,
        receiver_acc_id: AccountId,
        memo: String,
    ) -> Promise {
        let signer_pk = env::signer_account_pk();
        let puzzle = self
            .puzzles
            .get(&crossword_pk)
            .expect("Not a correct public key to solve puzzle");

        match puzzle.status {
            PuzzleStatus::Solved {
                solver_pk: ref puzzle_pk,
            } => {
                assert_eq!(signer_pk, *puzzle_pk, "You're not the person who can claim this, or else you need to use your function-call access key, friend.");
            }
            _ => {
                env::panic_str("puzzle should have `Solved` status to be claimed");
            }
        };

        let reward_amount = puzzle.reward;
        assert!(
            env::account_balance().as_yoctonear() >= reward_amount,
            "The smart contract does not have enough balance to pay this out. :/"
        );

        Promise::new(receiver_acc_id.clone())
            .transfer(NearToken::from_yoctonear(puzzle.reward))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ACCOUNT_CALLBACK)
                    .callback_after_transfer(
                        crossword_pk,
                        receiver_acc_id.to_string(),
                        memo,
                        env::signer_account_pk(),
                    ),
            )
    }

    #[payable]
    pub fn new_puzzle(
        &mut self,
        answer_pk: PublicKey,
        dimensions: CoordinatePair,
        answers: Vec<Answer>,
    ) {
        let value_transferred = env::attached_deposit();
        let creator = env::predecessor_account_id();
        let existing = self.puzzles.insert(
            &answer_pk,
            &Puzzle {
                status: PuzzleStatus::Unsolved,
                reward: value_transferred.as_yoctonear(),
                creator,
                dimensions,
                answer: answers,
            },
        );

        assert!(existing.is_none(), "Puzzle with that key already exists");
        self.unsolved_puzzles.insert(&answer_pk);

        Promise::new(env::current_account_id())
            .add_access_key_allowance(
                answer_pk,
                Allowance::limited(NearToken::from_millinear(250)).unwrap(),
                env::current_account_id(),
                "submit_solution".to_string(),
            )
            .detach();
    }

    pub fn get_unsolved_puzzles(&self) -> UnsolvedPuzzles {
        let public_keys = self.unsolved_puzzles.to_vec();
        let mut all_unsolved_puzzles = vec![];
        for pk in public_keys {
            let puzzle = self
                .puzzles
                .get(&pk)
                .unwrap_or_else(|| env::panic_str("ERR_LOADING_PUZZLE"));
            let json_puzzle = JsonPuzzle {
                solution_public_key: get_decoded_pk(pk),
                status: puzzle.status,
                reward: puzzle.reward,
                creator: puzzle.creator,
                dimensions: puzzle.dimensions,
                answer: puzzle.answer,
            };
            all_unsolved_puzzles.push(json_puzzle)
        }
        UnsolvedPuzzles {
            puzzles: all_unsolved_puzzles,
            creator_account: self.creator_account.clone(),
        }
    }
}

/// Private functions
#[near]
impl Crossword {
    fn finalize_puzzle(
        &mut self,
        crossword_pk: PublicKey,
        account_id: String,
        memo: String,
        signer_pk: PublicKey,
    ) {
        let mut puzzle = self
            .puzzles
            .get(&crossword_pk)
            .expect("Error loading puzzle when finalizing.");

        puzzle.status = PuzzleStatus::Claimed { memo: memo.clone() };
        self.puzzles.insert(&crossword_pk, &puzzle);

        log!(
            "Puzzle with pk: {:?} claimed, new account created: {}, memo: {}, reward claimed: {}",
            crossword_pk,
            account_id,
            memo,
            puzzle.reward
        );

        Promise::new(env::current_account_id()).delete_key(signer_pk).detach();
    }

    #[private]
    pub fn callback_after_transfer(
        &mut self,
        crossword_pk: PublicKey,
        account_id: String,
        memo: String,
        signer_pk: PublicKey,
    ) -> bool {
        assert_eq!(
            env::promise_results_count(),
            1,
            "Expected 1 promise result."
        );
        match env::promise_result_checked(0, 1024) {
            Ok(_) => {
                self.finalize_puzzle(crossword_pk, account_id, memo, signer_pk);
                true
            }
            Err(_) => false,
        }
    }

    #[private]
    pub fn callback_after_create_account(
        &mut self,
        crossword_pk: PublicKey,
        account_id: String,
        memo: String,
        signer_pk: PublicKey,
    ) -> bool {
        assert_eq!(
            env::promise_results_count(),
            1,
            "Expected 1 promise result."
        );
        match env::promise_result_checked(0, 1024) {
            Ok(creation_result) => {
                let creation_succeeded: bool = serde_json::from_slice(&creation_result)
                    .expect("Could not turn result from account creation into boolean.");
                if creation_succeeded {
                    self.finalize_puzzle(crossword_pk, account_id, memo, signer_pk);
                    true
                } else {
                    false
                }
            }
            Err(_) => false,
        }
    }
}

fn get_decoded_pk(pk: PublicKey) -> String {
    let key_data: Vec<u8> = pk.into();
    let key_type = key_data[0];
    match key_type {
        0 => ["ed25519:", &bs58::encode(&key_data[1..]).into_string()].concat(),
        1 => ["secp256k1:", &bs58::encode(&key_data[1..]).into_string()].concat(),
        _ => env::panic_str("ERR_UNKNOWN_KEY_TYPE"),
    }
}

#[cfg(test)]
mod tests {}
