import { getPool } from "../../../src/lib/dbPool";

const SAFE_COLUMNS = `id, status, reward_amount, sanitized_preview AS preview_text, scheduled_at, uuid, activate_tx_hash, created_at, updated_at`;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const pool = getPool();

    const [activeResult, upcomingResult, recentResult] = await Promise.all([
      pool.query(
        `SELECT ${SAFE_COLUMNS} FROM puzzles WHERE status = 'active' ORDER BY created_at DESC`
      ),
      pool.query(
        `SELECT ${SAFE_COLUMNS} FROM puzzles WHERE status = 'awaiting_activation' AND scheduled_at > NOW() ORDER BY scheduled_at ASC`
      ),
      pool.query(
        `SELECT ${SAFE_COLUMNS} FROM puzzles WHERE status = 'delivered' ORDER BY updated_at DESC LIMIT 10`
      ),
    ]);

    return res.status(200).json({
      active: activeResult.rows,
      upcoming: upcomingResult.rows,
      recent: recentResult.rows,
    });
  } catch (err) {
    console.error("GET /api/puzzles error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
