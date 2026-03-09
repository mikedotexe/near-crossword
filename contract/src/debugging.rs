use crate::*;

#[near]
impl Crossword {
    pub fn debug_get_puzzle(&self, pk: PublicKey) {
        let puzzle = self.puzzles.get(&pk).expect("ERR_NO_PUZZLE");
        log!("Puzzle {:?}", puzzle);
    }
}
