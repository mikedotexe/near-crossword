use crate::*;

#[derive(BorshDeserialize, BorshSerialize, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct ReservedPuzzle {
    pub creator: AccountId,
    pub reward: u128,
    pub reserved_at: u64,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ReservationView {
    pub creator: AccountId,
    pub reward: u128,
    pub reserved_at: u64,
}

#[near]
impl Crossword {
    #[payable]
    pub fn reserve_puzzle(&mut self, uuid: String) {
        let deposit = env::attached_deposit();
        assert!(
            deposit >= NearToken::from_near(5),
            "Minimum reservation is 5 NEAR"
        );
        assert!(
            self.reserved_puzzles.get(&uuid).is_none(),
            "Reservation with that UUID already exists"
        );

        self.reserved_puzzles.insert(
            &uuid,
            &ReservedPuzzle {
                creator: env::predecessor_account_id(),
                reward: deposit.as_yoctonear(),
                reserved_at: env::block_timestamp(),
            },
        );

        log!("Puzzle reserved: uuid={}, deposit={}", uuid, deposit);
    }

    pub fn activate_puzzle(
        &mut self,
        uuid: String,
        answer_pk: PublicKey,
        dimensions: CoordinatePair,
        answers: Vec<Answer>,
    ) {
        self.assert_operator();

        let reservation = self
            .reserved_puzzles
            .remove(&uuid)
            .expect("No reservation found for that UUID");

        let existing = self.puzzles.insert(
            &answer_pk,
            &Puzzle {
                status: PuzzleStatus::Unsolved,
                reward: reservation.reward,
                creator: reservation.creator,
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

        log!("Puzzle activated from reservation: uuid={}", uuid);
    }

    pub fn cancel_reservation(&mut self, uuid: String) {
        let reservation = self
            .reserved_puzzles
            .get(&uuid)
            .expect("No reservation found for that UUID");

        let caller = env::predecessor_account_id();
        assert!(
            caller == reservation.creator || caller == self.operator_id || caller == self.owner_id,
            "Only creator, operator, or owner can cancel"
        );

        let reservation = self
            .reserved_puzzles
            .remove(&uuid)
            .expect("No reservation found");

        Promise::new(reservation.creator.clone())
            .transfer(NearToken::from_yoctonear(reservation.reward))
            .detach();

        log!(
            "Reservation cancelled: uuid={}, refund={} to {}",
            uuid,
            reservation.reward,
            reservation.creator
        );
    }

    pub fn get_reservation(&self, uuid: String) -> Option<ReservationView> {
        self.reserved_puzzles.get(&uuid).map(|r| ReservationView {
            creator: r.creator,
            reward: r.reward,
            reserved_at: r.reserved_at,
        })
    }
}
