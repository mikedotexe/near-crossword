import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clientAddress,
  enforceMagicLinkRateLimits,
  enforceRateLimit,
  isPrivateHost,
  localRateLimitBucketCountForTests,
  resetRateLimitsForTests,
} from "./security";

describe("v2 security helpers", () => {
  it("blocks private, loopback, link-local, and mapped addresses", () => {
    assert.equal(isPrivateHost("127.0.0.1"), true);
    assert.equal(isPrivateHost("10.0.0.1"), true);
    assert.equal(isPrivateHost("172.16.0.1"), true);
    assert.equal(isPrivateHost("192.168.1.1"), true);
    assert.equal(isPrivateHost("169.254.1.1"), true);
    assert.equal(isPrivateHost("::1"), true);
    assert.equal(isPrivateHost("::ffff:127.0.0.1"), true);
    assert.equal(isPrivateHost("8.8.8.8"), false);
  });

  it("enforces a bounded local rate limit", async () => {
    resetRateLimitsForTests();
    delete process.env.DATABASE_URL;
    await enforceRateLimit("test", { limit: 2, windowMs: 1_000, now: 10_000 });
    await enforceRateLimit("test", { limit: 2, windowMs: 1_000, now: 10_001 });
    await assert.rejects(
      enforceRateLimit("test", { limit: 2, windowMs: 1_000, now: 10_002 }),
      /Too many requests/,
    );
    await assert.doesNotReject(
      enforceRateLimit("test", { limit: 2, windowMs: 1_000, now: 12_000 }),
    );
  });

  it("keeps the local bucket map at a strict cap and admits after bounded expiry cleanup", async () => {
    resetRateLimitsForTests();
    delete process.env.DATABASE_URL;
    const now = 20_000;
    for (let index = 0; index < 10_000; index += 1) {
      await enforceRateLimit(`rotating-key:${index}`, {
        limit: 1,
        windowMs: 1_000,
        now,
      });
    }
    assert.equal(localRateLimitBucketCountForTests(), 10_000);
    await assert.rejects(
      enforceRateLimit("rotating-key:overflow", {
        limit: 1,
        windowMs: 1_000,
        now,
      }),
      /Too many requests/,
    );
    assert.equal(localRateLimitBucketCountForTests(), 10_000);

    await assert.doesNotReject(
      enforceRateLimit("rotating-key:after-expiry", {
        limit: 1,
        windowMs: 1_000,
        now: now + 2_000,
      }),
    );
    assert.ok(localRateLimitBucketCountForTests() <= 10_000);
  });

  it("limits magic links by source even when recipients rotate", async () => {
    resetRateLimitsForTests();
    delete process.env.DATABASE_URL;
    const now = 30_000;
    for (let index = 0; index < 10; index += 1) {
      await enforceMagicLinkRateLimits(
        `recipient-${index}@example.test`,
        "198.51.100.9",
        { now },
      );
    }
    await assert.rejects(
      enforceMagicLinkRateLimits(
        "recipient-overflow@example.test",
        "198.51.100.9",
        { now },
      ),
      /Too many requests/,
    );
  });

  it("retains the per-recipient magic-link ceiling across source addresses", async () => {
    resetRateLimitsForTests();
    delete process.env.DATABASE_URL;
    const now = 40_000;
    for (let index = 0; index < 5; index += 1) {
      await enforceMagicLinkRateLimits(
        "same-recipient@example.test",
        `198.51.100.${index + 1}`,
        { now },
      );
    }
    await assert.rejects(
      enforceMagicLinkRateLimits(
        "same-recipient@example.test",
        "198.51.100.20",
        { now },
      ),
      /Too many requests/,
    );
  });

  it("applies a service-wide magic-link backstop across rotating sources and recipients", async () => {
    resetRateLimitsForTests();
    delete process.env.DATABASE_URL;
    const now = 50_000;
    for (let index = 0; index < 1_000; index += 1) {
      const thirdOctet = Math.floor(index / 250);
      const fourthOctet = (index % 250) + 1;
      await enforceMagicLinkRateLimits(
        `global-recipient-${index}@example.test`,
        `203.0.${thirdOctet}.${fourthOctet}`,
        { now },
      );
    }
    await assert.rejects(
      enforceMagicLinkRateLimits(
        "global-overflow@example.test",
        "198.51.100.200",
        { now },
      ),
      /Too many requests/,
    );
  });

  it("ignores spoofable forwarding headers unless ingress trust is explicit", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    delete process.env.V2_TRUSTED_CLIENT_IP_HEADER;
    const request = new Request("https://example.test", {
      headers: {
        "x-forwarded-for": "198.51.100.8, 10.0.0.2",
      },
    });
    assert.equal(clientAddress(request), "unknown");
    process.env.V2_TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";
    assert.equal(clientAddress(request), "198.51.100.8");
    process.env.V2_TRUSTED_CLIENT_IP_HEADER = "x-not-supported";
    assert.equal(clientAddress(request), "unknown");
    delete process.env.V2_TRUSTED_CLIENT_IP_HEADER;
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  it("fails closed when production ingress addressing is absent or invalid", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.V2_TRUSTED_CLIENT_IP_HEADER;
    const request = new Request("https://example.test");
    assert.throws(() => clientAddress(request), /Trusted ingress/);
    process.env.V2_TRUSTED_CLIENT_IP_HEADER = "x-real-ip";
    assert.throws(() => clientAddress(request), /Trusted ingress/);
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    delete process.env.V2_TRUSTED_CLIENT_IP_HEADER;
  });
});
