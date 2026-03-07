import pg from "pg";
import config from "./config.js";

const pool = new pg.Pool({ connectionString: config.databaseUrl });

export interface PuzzleRow {
  id: string;
  assignment_id: string | null;
  job_id: string | null;
  email: string | null;
  source_content: string | null;
  variations_json: any;
  chosen_pairs: any;
  reward_amount: string | null;
  puzzle_data: any;
  preview_text: string | null;
  scheduled_at: Date | null;
  uuid: string | null;
  reserve_tx_hash: string | null;
  activate_tx_hash: string | null;
  answer_pk: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  last_error: string | null;
  retry_count: number;
  pre_payment_balance: string | null;
  last_message_count: number;
  sanitized_preview: string | null;
}

export async function createPuzzle(fields: {
  assignment_id: string;
  job_id: string;
  source_content?: string;
  status?: string;
}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO puzzles (assignment_id, job_id, source_content, status)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      fields.assignment_id,
      fields.job_id,
      fields.source_content || null,
      fields.status || "generating",
    ]
  );
  return rows[0].id;
}

export async function updatePuzzleStatus(
  id: string,
  status: string,
  extra?: Record<string, any>
): Promise<void> {
  const sets = ["status = $2"];
  const values: any[] = [id, status];
  let idx = 3;

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      sets.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }

  await pool.query(
    `UPDATE puzzles SET ${sets.join(", ")} WHERE id = $1`,
    values
  );
}

export async function getPuzzleByAssignment(
  assignmentId: string
): Promise<PuzzleRow | null> {
  const { rows } = await pool.query(
    "SELECT * FROM puzzles WHERE assignment_id = $1",
    [assignmentId]
  );
  return rows[0] || null;
}

export async function getPuzzleById(id: string): Promise<PuzzleRow | null> {
  const { rows } = await pool.query("SELECT * FROM puzzles WHERE id = $1", [
    id,
  ]);
  return rows[0] || null;
}

export async function getPuzzlesReadyToActivate(): Promise<PuzzleRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM puzzles
     WHERE status = 'awaiting_activation'
       AND scheduled_at <= NOW()
     ORDER BY scheduled_at ASC
     FOR UPDATE SKIP LOCKED`
  );
  return rows;
}

export async function getNonTerminalPuzzles(): Promise<PuzzleRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM puzzles
     WHERE status NOT IN ('delivered', 'cancelled', 'error')
     ORDER BY created_at ASC`
  );
  return rows;
}

export async function shutdown(): Promise<void> {
  await pool.end();
}
