import { getPool } from "../../../src/lib/dbPool";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { reward_amount, activate_tx_hash, preview_text } = req.body || {};

  if (!reward_amount || !activate_tx_hash) {
    return res.status(400).json({ error: "reward_amount and activate_tx_hash are required" });
  }

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO puzzles (status, reward_amount, activate_tx_hash, sanitized_preview)
       VALUES ('active', $1, $2, $3)
       RETURNING id`,
      [reward_amount, activate_tx_hash, preview_text || null]
    );

    return res.status(201).json({ id: rows[0].id });
  } catch (err) {
    console.error("POST /api/puzzles/create error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
