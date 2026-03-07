ALTER TYPE puzzle_status ADD VALUE IF NOT EXISTS 'awaiting_schedule'
  AFTER 'awaiting_preview_confirm';

ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS pre_payment_balance TEXT;
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS last_message_count INTEGER DEFAULT 0;
ALTER TABLE puzzles ADD COLUMN IF NOT EXISTS sanitized_preview TEXT;

UPDATE puzzles SET puzzle_data = puzzle_data - 'seedPhrase' - 'answers'
  WHERE puzzle_data IS NOT NULL AND puzzle_data ? 'seedPhrase';
