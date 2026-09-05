import type { Pool, PoolClient } from "pg";
import { AppError } from "../v2/errors";

export async function transaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof AppError) throw error;
    // PostgreSQL errors can include private JSON values. Do not pass them to HTTP logging.
    throw new AppError(503, "BASE_WORKFLOW_UNAVAILABLE", "The learning workflow is temporarily unavailable");
  } finally { client?.release(); }
}

export function conflict(message: string): never {
  throw new AppError(409, "BASE_WORKFLOW_CONFLICT", message);
}

export function notFound(): never {
  throw new AppError(404, "NOT_FOUND", "Learning campaign not found");
}

export async function assertPublished(client: PoolClient, id: string, revision: number) {
  const result = await client.query("SELECT 1 FROM base_learning_publications WHERE campaign_id = $1 AND revision = $2 AND withdrawn_at IS NULL", [id, revision]);
  if (!result.rowCount) conflict("This lesson is not accepting new completions or allocations");
}
