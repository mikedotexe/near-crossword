import pg from "pg";
import { AppError } from "./errors";
import { isExplicitMockMode, requireProductionConfiguration } from "./config";
import { MemoryRepository } from "./memory-repository";
import { PostgresRepository } from "./postgres-repository";
import type { Repository } from "./repository";

const globalKey = Symbol.for("near-crossword.v2.repository");
const poolKey = Symbol.for("near-crossword.v2.postgres-pool");

type Globals = typeof globalThis & {
  [globalKey]?: Repository;
  [poolKey]?: pg.Pool;
};

export function getDatabasePool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new AppError(503, "DATABASE_NOT_CONFIGURED", "DATABASE_URL is required");
  }
  const globals = globalThis as Globals;
  if (!globals[poolKey]) {
    globals[poolKey] = new pg.Pool({
      connectionString,
      max: Number(process.env.V2_DATABASE_POOL_SIZE || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl:
        process.env.V2_DATABASE_SSL === "require"
          ? { rejectUnauthorized: true }
          : undefined,
    });
  }
  return globals[poolKey]!;
}

export function getRepository(): Repository {
  requireProductionConfiguration();
  const globals = globalThis as Globals;
  if (globals[globalKey]) return globals[globalKey]!;
  if (process.env.DATABASE_URL) {
    globals[globalKey] = new PostgresRepository(getDatabasePool());
    return globals[globalKey]!;
  }
  if (isExplicitMockMode()) {
    globals[globalKey] = new MemoryRepository();
    return globals[globalKey]!;
  }
  throw new AppError(
    503,
    "DATABASE_NOT_CONFIGURED",
    "DATABASE_URL is required. Local in-memory mode requires V2_FUNDING_MODE=mock.",
  );
}

export function resetRepositorySingletonForTests(): void {
  const globals = globalThis as Globals;
  delete globals[globalKey];
}
