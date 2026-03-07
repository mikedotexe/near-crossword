use crate::*;

impl Crossword {
    pub(crate) fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner_id,
            "Only owner can call this"
        );
    }

    pub(crate) fn assert_operator(&self) {
        assert!(
            env::predecessor_account_id() == self.operator_id
                || env::predecessor_account_id() == self.owner_id,
            "Only operator or owner can call this"
        );
    }
}

#[near]
impl Crossword {
    pub fn set_operator(&mut self, new_operator_id: AccountId) {
        self.assert_owner();
        log!(
            "Operator changed from {} to {}",
            self.operator_id,
            new_operator_id
        );
        self.operator_id = new_operator_id;
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn get_operator(&self) -> AccountId {
        self.operator_id.clone()
    }
}
