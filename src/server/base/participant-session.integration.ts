import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { after, before, beforeEach, test } from "node:test";
import pg from "pg";
import { getPool } from "../../lib/dbPool";
import { getDatabasePool } from "../v2/repository-factory";
import { resetRateLimitsForTests } from "../v2/security";
import {
  createParticipantSessionHandlers,
  type ValidatedCdpUser,
} from "./participant-session";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error("TEST_DATABASE_URL must name disposable local PostgreSQL");
}
const url = new URL(connectionString);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
  throw new Error("Participant session tests refuse nonlocal PostgreSQL");
}
const schema = `base_cdp_session_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString, max: 1 });
url.searchParams.set("options", `-c search_path=${schema}`);
const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
const origin = "https://crossword.example.test";
const accessToken = `eyJ.${"a".repeat(80)}.signature`;
const recipient = "0x3333333333333333333333333333333333333333";
const priorEnv = Object.fromEntries(
  [
    "DATABASE_URL",
    "V2_DATABASE_SSL",
    "V2_TRUSTED_CLIENT_IP_HEADER",
    "NODE_ENV",
  ].map((key) => [key, process.env[key]]),
);

function validated(email = "learner@example.test"): ValidatedCdpUser {
  return {
    userId: "cdp-user-123",
    authenticationMethods: [{ type: "email", email }],
    evmSmartAccountObjects: [
      {
        address: recipient,
        ownerAddresses: ["0x4444444444444444444444444444444444444444"],
        createdAt: new Date(0).toISOString(),
      },
    ],
  };
}

const handlers = createParticipantSessionHandlers({
  enabled: () => true,
  origin: () => origin,
  pool: () => pool,
  validator: () => ({
    validate: async (token) => {
      assert.equal(token, accessToken);
      return validated();
    },
  }),
});

function request(
  method: "POST" | "DELETE",
  options: { body?: unknown; cookie?: string; from?: string } = {},
) {
  const headers: Record<string, string> = {
    origin: options.from ?? origin,
    "x-real-ip": "127.0.0.1",
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.cookie) headers.cookie = options.cookie;
  return new Request(`${origin}/api/base/auth/session`, {
    method,
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  const migrated = spawnSync(process.execPath, ["scripts/migrate-v2.mjs"], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(migrated.status, 0, "Participant session migrations must succeed");
  Object.assign(process.env, {
    DATABASE_URL: url.toString(),
    V2_DATABASE_SSL: "disable",
    V2_TRUSTED_CLIENT_IP_HEADER: "x-real-ip",
    NODE_ENV: "test",
  });
});

beforeEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
  await pool.query("TRUNCATE v2_rate_limit_buckets");
  resetRateLimitsForTests();
});

after(async () => {
  await getDatabasePool().end();
  await getPool().end();
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
  for (const [key, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("validated CDP login creates one verified user, linked account and short database session", async () => {
  const response = await handlers.post(
    request("POST", { body: { accessToken, recipient } }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(
    {
      status: body.status,
      email: body.email,
      recipient: body.recipient,
    },
    {
      status: "AUTHENTICATED",
      email: "learner@example.test",
      recipient,
    },
  );
  assert.doesNotMatch(JSON.stringify(body), new RegExp(accessToken));
  const cookie = response.headers.get("set-cookie") || "";
  assert.match(cookie, /^__Secure-next-auth\.session-token=[0-9a-f]{64};/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);

  const saved = await pool.query(
    `SELECT u.email, u.email_verified, a.provider, a.provider_account_id,
            a.access_token, s.expires
     FROM users u
     JOIN accounts a ON a.user_id = u.id
     JOIN sessions s ON s.user_id = u.id`,
  );
  assert.equal(saved.rowCount, 1);
  assert.equal(saved.rows[0].email, "learner@example.test");
  assert.ok(saved.rows[0].email_verified);
  assert.equal(saved.rows[0].provider, "coinbase-cdp");
  assert.equal(saved.rows[0].provider_account_id, "cdp-user-123");
  assert.equal(saved.rows[0].access_token, null);
  const lifetime = new Date(saved.rows[0].expires).getTime() - Date.now();
  assert.ok(lifetime > 12 * 60_000 && lifetime <= 14 * 60_000);
});

test("CDP login links an existing email identity and retries without duplicating users", async () => {
  const existing = await pool.query(
    "INSERT INTO users (email) VALUES ('learner@example.test') RETURNING id::TEXT",
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await handlers.post(
      request("POST", { body: { accessToken, recipient } }),
    );
    assert.equal(response.status, 200);
  }
  assert.equal((await pool.query("SELECT * FROM users")).rowCount, 1);
  assert.equal((await pool.query("SELECT * FROM accounts")).rowCount, 1);
  assert.equal((await pool.query("SELECT * FROM sessions")).rowCount, 2);
  const linked = await pool.query(
    "SELECT user_id::TEXT FROM accounts WHERE provider = 'coinbase-cdp'",
  );
  assert.equal(linked.rows[0].user_id, existing.rows[0].id);
});

test("session endpoint rejects cross-origin and unowned-account requests without persistence", async () => {
  const crossOrigin = await handlers.post(
    request("POST", {
      from: "https://elsewhere.example",
      body: { accessToken, recipient },
    }),
  );
  assert.equal(crossOrigin.status, 403);

  const wrongWalletHandlers = createParticipantSessionHandlers({
    enabled: () => true,
    origin: () => origin,
    pool: () => pool,
    validator: () => ({ validate: async () => validated() }),
  });
  const wrongWallet = await wrongWalletHandlers.post(
    request("POST", {
      body: {
        accessToken,
        recipient: "0x5555555555555555555555555555555555555555",
      },
    }),
  );
  assert.equal(wrongWallet.status, 403);
  assert.equal((await pool.query("SELECT * FROM users")).rowCount, 0);
  assert.equal((await pool.query("SELECT * FROM sessions")).rowCount, 0);
});

test("participant sign-out deletes only the presented database session", async () => {
  const signedIn = await handlers.post(
    request("POST", { body: { accessToken, recipient } }),
  );
  const cookie = signedIn.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await pool.query("SELECT * FROM sessions")).rowCount, 1);
  const response = await handlers.delete(request("DELETE", { cookie }));
  assert.equal(response.status, 200);
  assert.equal((await pool.query("SELECT * FROM sessions")).rowCount, 0);
  assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/);
});
