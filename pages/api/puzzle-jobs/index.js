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

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, input_mode, tone, status, created_at, completed_at, variations_json, error_message
     FROM puzzle_jobs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [session.user.id]
  );

  return res.status(200).json({ jobs: rows });
}
