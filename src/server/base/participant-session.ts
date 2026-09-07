import { randomBytes } from "node:crypto";
import { CdpClient, type EndUserAccount } from "@coinbase/cdp-sdk";
import type { Pool } from "pg";
import { getAddress, type Address } from "viem";
import { z } from "zod";
import { databaseSessionToken } from "../v2/auth";
import { AppError } from "../v2/errors";
import { json, readJson, withErrors } from "../v2/http";
import { getDatabasePool } from "../v2/repository-factory";
import { clientAddress, enforceRateLimit } from "../v2/security";
import { bounded } from "./bounded";
import { transaction } from "./database";
import { participantOrigin } from "./participant-input";

const SESSION_SECONDS = 14 * 60;
const inputSchema = z
  .object({
    accessToken: z
      .string()
      .min(32)
      .max(8192)
      .regex(/^[A-Za-z0-9._-]+$/),
    recipient: z.string(),
  })
  .strict();

export type ValidatedCdpUser = Pick<
  EndUserAccount,
  "userId" | "authenticationMethods" | "evmSmartAccountObjects"
>;

export interface CdpTokenValidator {
  validate(accessToken: string): Promise<ValidatedCdpUser>;
}

export type ParticipantIdentity = {
  cdpUserId: string;
  email: string;
  recipient: Address;
};

function checkedRecipient(value: string): Address {
  try {
    const address = getAddress(value).toLowerCase() as Address;
    if (BigInt(address) !== 0n) return address;
  } catch {
    // Submitted account data is never reflected in an error.
  }
  throw new AppError(400, "INVALID_CDP_SESSION", "Coinbase Wallet session is invalid");
}

export function participantIdentity(
  user: ValidatedCdpUser,
  requestedRecipient: string,
): ParticipantIdentity {
  if (!/^[A-Za-z0-9-]{1,100}$/.test(user.userId)) {
    throw new AppError(401, "CDP_SESSION_INVALID", "Coinbase session could not be verified");
  }
  const emails = new Set(
    user.authenticationMethods
      .filter(
        (method): method is Extract<(typeof user.authenticationMethods)[number], { type: "email" }> =>
          method.type === "email",
      )
      .map((method) => method.email.trim().toLowerCase()),
  );
  if (emails.size !== 1) {
    throw new AppError(403, "CDP_EMAIL_REQUIRED", "Verify one email address with Coinbase");
  }
  const email = [...emails][0];
  if (!z.string().email().safeParse(email).success) {
    throw new AppError(403, "CDP_EMAIL_REQUIRED", "Verify one email address with Coinbase");
  }
  const recipient = checkedRecipient(requestedRecipient);
  const ownsRecipient = user.evmSmartAccountObjects.some(
    (account) => checkedRecipient(account.address) === recipient,
  );
  if (!ownsRecipient) {
    throw new AppError(
      403,
      "CDP_SMART_ACCOUNT_REQUIRED",
      "Use the smart account attached to this Coinbase session",
    );
  }
  return { cdpUserId: user.userId, email, recipient };
}

export async function createDatabaseSession(
  pool: Pool,
  identity: ParticipantIdentity,
  now = new Date(),
) {
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(now.getTime() + SESSION_SECONDS * 1000);
  const userId = await transaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`coinbase-cdp:${identity.cdpUserId}`],
    );
    const linked = await client.query(
      `SELECT u.id::TEXT, lower(u.email) AS email
       FROM accounts a
       JOIN users u ON u.id = a.user_id
       WHERE a.provider = 'coinbase-cdp' AND a.provider_account_id = $1
       FOR UPDATE OF a, u`,
      [identity.cdpUserId],
    );
    let id: string;
    if (linked.rowCount) {
      if (linked.rows[0].email !== identity.email) {
        throw new AppError(
          409,
          "CDP_ACCOUNT_RECOVERY_REQUIRED",
          "This Coinbase account is linked to a different verified email",
        );
      }
      id = linked.rows[0].id;
      await client.query(
        `UPDATE users
         SET email_verified = COALESCE(email_verified, $2), updated_at = $2
         WHERE id = $1`,
        [id, now],
      );
    } else {
      const matching = await client.query(
        "SELECT id::TEXT FROM users WHERE lower(email) = $1 ORDER BY id FOR UPDATE",
        [identity.email],
      );
      if ((matching.rowCount ?? 0) > 1) {
        throw new AppError(
          409,
          "CDP_ACCOUNT_RECOVERY_REQUIRED",
          "This email requires account recovery before it can be linked",
        );
      }
      if (matching.rowCount) {
        id = matching.rows[0].id;
        await client.query(
          `UPDATE users
           SET email = $2, email_verified = COALESCE(email_verified, $3), updated_at = $3
           WHERE id = $1`,
          [id, identity.email, now],
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO users (email, email_verified, created_at, updated_at)
           VALUES ($1, $2, $2, $2)
           RETURNING id::TEXT`,
          [identity.email, now],
        );
        id = inserted.rows[0].id;
      }
      await client.query(
        `INSERT INTO accounts (user_id, type, provider, provider_account_id)
         VALUES ($1, 'email', 'coinbase-cdp', $2)`,
        [id, identity.cdpUserId],
      );
    }
    await client.query(
      `INSERT INTO sessions (user_id, session_token, expires)
       VALUES ($1, $2, $3)`,
      [id, sessionToken, expires],
    );
    return id;
  });
  return { userId, sessionToken, expires };
}

function sessionCookie(
  origin: string,
  value: string,
  maxAge: number,
): string {
  const secure = new URL(origin).protocol === "https:";
  const name = secure
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function requireSameOrigin(request: Request, origin: string) {
  if (
    request.headers.get("origin") !== origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new AppError(403, "ORIGIN_REQUIRED", "A same-origin sign-in is required");
  }
}

let productionClient: CdpClient | undefined;
export function cdpTokenValidatorFromEnvironment(): CdpTokenValidator {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) {
    throw new AppError(
      503,
      "CDP_AUTH_UNAVAILABLE",
      "Coinbase participant sign-in is not configured",
    );
  }
  productionClient ??= new CdpClient({
    apiKeyId,
    apiKeySecret,
    debugging: false,
  });
  return {
    async validate(accessToken) {
      try {
        return await bounded(
          () => productionClient!.endUser.validateAccessToken({ accessToken }),
          10_000,
        );
      } catch (error) {
        const status =
          typeof error === "object" &&
          error &&
          "statusCode" in error &&
          typeof error.statusCode === "number"
            ? error.statusCode
            : 0;
        if ([400, 401, 404].includes(status)) {
          throw new AppError(
            401,
            "CDP_SESSION_INVALID",
            "Coinbase session could not be verified",
          );
        }
        throw new AppError(
          503,
          "CDP_AUTH_UNAVAILABLE",
          "Coinbase participant sign-in is temporarily unavailable",
        );
      }
    },
  };
}

type SessionServices = {
  enabled: () => boolean;
  origin: () => string;
  pool: () => Pool;
  validator: () => CdpTokenValidator;
};

const productionServices: SessionServices = {
  enabled: () => process.env.CDP_PARTICIPANT_AUTH_ENABLED === "true",
  origin: () => participantOrigin(),
  pool: () => getDatabasePool(),
  validator: () => cdpTokenValidatorFromEnvironment(),
};

export function createParticipantSessionHandlers(
  services: SessionServices = productionServices,
) {
  return {
    post: withErrors(async (request: Request) => {
      if (!services.enabled()) {
        throw new AppError(404, "NOT_FOUND", "Not found");
      }
      const origin = services.origin();
      requireSameOrigin(request, origin);
      if (
        request.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() !== "application/json"
      ) {
        throw new AppError(415, "JSON_REQUIRED", "A JSON request is required");
      }
      await enforceRateLimit(
        `cdp-participant-session:ip:${clientAddress(request)}`,
        { limit: 30, windowMs: 60 * 60 * 1000 },
      );
      const parsed = inputSchema.safeParse(await readJson(request, 12 * 1024));
      if (!parsed.success) {
        throw new AppError(
          400,
          "INVALID_CDP_SESSION",
          "Coinbase Wallet session is invalid",
        );
      }
      const user = await services.validator().validate(parsed.data.accessToken);
      const identity = participantIdentity(user, parsed.data.recipient);
      const session = await createDatabaseSession(services.pool(), identity);
      const response = json({
        status: "AUTHENTICATED",
        email: identity.email,
        recipient: identity.recipient,
        expiresAt: session.expires.toISOString(),
      });
      response.headers.append(
        "set-cookie",
        sessionCookie(origin, session.sessionToken, SESSION_SECONDS),
      );
      return response;
    }),
    delete: withErrors(async (request: Request) => {
      if (!services.enabled()) {
        throw new AppError(404, "NOT_FOUND", "Not found");
      }
      const origin = services.origin();
      requireSameOrigin(request, origin);
      const token = databaseSessionToken(request);
      if (token) {
        await services.pool().query(
          "DELETE FROM sessions WHERE session_token = $1",
          [token],
        );
      }
      const response = json({ status: "SIGNED_OUT" });
      response.headers.append("set-cookie", sessionCookie(origin, "", 0));
      return response;
    }),
  };
}

export const participantSessionHandlers = createParticipantSessionHandlers();
