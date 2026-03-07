import { getPool } from "../../../src/lib/dbPool";

const SAFE_COLUMNS = `id, status, reward_amount, sanitized_preview AS preview_text, scheduled_at, uuid, activate_tx_hash, created_at, updated_at`;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT ${SAFE_COLUMNS} FROM puzzles WHERE id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Puzzle not found" });
    }

    return res.status(200).json(rows[0]);
  } catch (err) {
    console.error(`GET /api/puzzles/${id} error:`, err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
