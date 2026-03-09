import { getSession } from "../../../src/lib/auth-helpers";
import { getPool } from "../../../src/lib/dbPool";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getSession(req, res);
  if (!session) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const { id } = req.query;
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, input_mode, tone, objective, status, created_at, completed_at,
            variations_json, error_message, retry_count
     FROM puzzle_jobs
     WHERE id = $1 AND user_id = $2`,
    [id, session.user.id]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Job not found" });
  }

  return res.status(200).json({ job: rows[0] });
}
