import assert from "node:assert/strict";
import { test } from "node:test";
import {
  participantIdentity,
  type ValidatedCdpUser,
} from "./participant-session";

const recipient = "0x3333333333333333333333333333333333333333";

function user(
  patch: Partial<ValidatedCdpUser> = {},
): ValidatedCdpUser {
  return {
    userId: "cdp-user-123",
    authenticationMethods: [
      { type: "email", email: "Learner@Example.Test" },
    ],
    evmSmartAccountObjects: [
      {
        address: recipient,
        ownerAddresses: ["0x4444444444444444444444444444444444444444"],
        createdAt: new Date(0).toISOString(),
      },
    ],
    ...patch,
  };
}

test("validated CDP identity binds one verified email to the requested smart account", () => {
  assert.deepEqual(participantIdentity(user(), recipient), {
    cdpUserId: "cdp-user-123",
    email: "learner@example.test",
    recipient,
  });
});

test("CDP identity rejects invalid subjects, ambiguous email and unowned recipients", () => {
  assert.throws(
    () => participantIdentity(user({ userId: "invalid subject" }), recipient),
    { code: "CDP_SESSION_INVALID" },
  );
  assert.throws(
    () =>
      participantIdentity(
        user({
          authenticationMethods: [
            { type: "email", email: "one@example.test" },
            { type: "email", email: "two@example.test" },
          ],
        }),
        recipient,
      ),
    { code: "CDP_EMAIL_REQUIRED" },
  );
  assert.throws(
    () =>
      participantIdentity(
        user(),
        "0x5555555555555555555555555555555555555555",
      ),
    { code: "CDP_SMART_ACCOUNT_REQUIRED" },
  );
});
