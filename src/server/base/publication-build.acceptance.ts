import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import pg from "pg";
import { PostgresReviewRepository } from "./review-repository";
import { reviewFixture } from "./workflow.fixture";

test(
  "production build loads the private layout engine, traces its source, and refuses dev previews",
  { timeout: 60000 },
  async () => {
    const connectionString = process.env.TEST_DATABASE_URL;
    assert.ok(
      connectionString,
      "TEST_DATABASE_URL must name disposable local PostgreSQL",
    );
    const url = new URL(connectionString);
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      "Refusing a nonlocal database",
    );
    const trace = JSON.parse(
      readFileSync(
        ".next/server/app/api/base/reviews/[id]/publication/route.js.nft.json",
        "utf8",
      ),
    );
    assert.ok(
      trace.files.some((file: string) =>
        file.endsWith(
          "node_modules/crossword-layout-generator/src/layout_generator.js",
        ),
      ),
    );
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const address = reservation.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    );
    const origin = `http://127.0.0.1:${port}`;
    const schema = `base_build_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({ connectionString, max: 1 });
    url.searchParams.set("options", `-c search_path=${schema}`);
    const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
    let child: ReturnType<typeof spawn> | undefined;
    let exited: Promise<unknown> | undefined;
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        DATABASE_URL: url.toString(),
        NEXTAUTH_URL: origin,
        V2_DATABASE_SSL: "disable",
        NODE_ENV: "production",
        V2_TRUSTED_CLIENT_IP_HEADER: "x-real-ip",
        BASE_REVIEW_ENABLED: "true",
        BASE_PUBLICATION_ENABLED: "true",
        BASE_UI_PREVIEW_ENABLED: "true",
        BASE_ACCOUNT_ENABLED: "false",
        BASE_SPONSORED_GAS_ENABLED: "false",
        BASE_CLAIM_ISSUANCE_ENABLED: "false",
        BASE_PARTICIPANT_ENABLED: "false",
        BASE_INDEXER_ENABLED: "false",
        V2_CHAIN_BROADCAST_ENABLED: "false",
        V2_FUNDING_MODE: "direct",
      };
      const migration = spawnSync(
        process.execPath,
        ["scripts/migrate-v2.mjs"],
        { env, encoding: "utf8", timeout: 30000 },
      );
      assert.equal(
        migration.status,
        0,
        "Build acceptance migrations must succeed",
      );
      const user = await pool.query(
        "INSERT INTO users (email, email_verified) VALUES ('build-check@example.test', NOW()) RETURNING id::TEXT",
      );
      const owner = user.rows[0].id,
        session = randomUUID();
      await pool.query(
        "INSERT INTO sessions (user_id, session_token, expires) VALUES ($1, $2, NOW() + INTERVAL '1 hour')",
        [owner, session],
      );
      const reviews = new PostgresReviewRepository(pool);
      const review = await reviews.create(owner, randomUUID(), reviewFixture());
      await reviews.approve(
        owner,
        review.id,
        1,
        review.reviewHash,
        review.termsHash,
      );
      const server = spawn(
        process.execPath,
        [
          "node_modules/next/dist/bin/next",
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        { env, stdio: "ignore" },
      );
      child = server;
      exited = once(server, "exit");
      let ready = false;
      for (let i = 0; i < 50; i++) {
        try {
          ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) }))
            .ok;
        } catch {
          /* Server starting. */
        }
        if (ready) break;
        if (server.exitCode !== null)
          throw new Error("Production server exited during startup");
        await sleep(100);
      }
      assert.ok(ready);
      for (const path of ["/learn/preview", "/learn/studio/preview"])
        assert.equal((await fetch(origin + path)).status, 404);
      const path = `/api/base/reviews/${review.id}/publication`;
      assert.equal((await fetch(origin + path)).status, 401);
      const result = await fetch(origin + path, {
        headers: {
          cookie: `next-auth.session-token=${session}`,
          "x-real-ip": "127.0.0.1",
        },
      });
      const body = await result.json();
      assert.equal(
        result.status,
        200,
        `Compiled private layout API: ${body?.error?.code || "ok"}`,
      );
      assert.equal(result.headers.get("cache-control"), "no-store");
      assert.equal(body.layout.entries.length, 3);
      assert.equal(body.layout.rows, 7);
      assert.doesNotMatch(
        JSON.stringify(body),
        /WALLET|LEDGER|TRANSFER|sourceId|quote/,
      );
      assert.deepEqual(
        (
          await (
            await fetch(origin + "/api/base/lessons", {
              headers: { "x-real-ip": "127.0.0.1" },
            })
          ).json()
        ).lessons,
        [],
      );
    } finally {
      if (child) {
        child.kill("SIGTERM");
        const force = setTimeout(() => child?.kill("SIGKILL"), 3000);
        try {
          await exited;
        } finally {
          clearTimeout(force);
        }
      }
      await pool.end();
      try {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await admin.end();
      }
    }
  },
);
