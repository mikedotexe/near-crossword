import assert from "node:assert/strict";
import { test } from "node:test";
import { bounded } from "./bounded";

test("bounded adapters cancel a stalled call and do not retry it", async () => {
  let calls = 0;
  let cancelled = false;
  await assert.rejects(bounded(async (signal) => {
    calls++;
    signal.addEventListener("abort", () => { cancelled = true; });
    return new Promise(() => undefined);
  }, 10));
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});

test("bounded adapters return successes and propagate failures to their sanitizing boundary", async () => {
  assert.equal(await bounded(async () => 42, 100), 42);
  await assert.rejects(bounded(async () => { throw new Error("test-only failure"); }, 100), { message: "test-only failure" });
});
