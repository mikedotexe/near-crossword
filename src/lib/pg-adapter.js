/**
 * Custom PostgreSQL Adapter for NextAuth — snake_case columns.
 * Ported from ~/near/fn/dashboard/src/lib/pg-adapter-server-session.ts
 */
import { getPool } from "./dbPool";

export default function PgAdapter() {
  const client = getPool();

  return {
    async createVerificationToken(verificationToken) {
      const { identifier, expires, token } = verificationToken;
      await client.query(
        "INSERT INTO verification_tokens (identifier, expires, token) VALUES ($1, $2, $3)",
        [identifier, expires, token]
      );
      return verificationToken;
    },

    async useVerificationToken({ identifier, token }) {
      const result = await client.query(
        "DELETE FROM verification_tokens WHERE identifier = $1 AND token = $2 RETURNING identifier, expires, token",
        [identifier, token]
      );
      if (result.rowCount === 0) return null;
      return {
        identifier: result.rows[0].identifier,
        token: result.rows[0].token,
        expires: result.rows[0].expires,
      };
    },

    async createUser(user) {
      const { name, email, emailVerified, image } = user;
      const result = await client.query(
        "INSERT INTO users (name, email, email_verified, image) VALUES ($1, $2, $3, $4) RETURNING id, name, email, email_verified, image",
        [name, email, emailVerified, image]
      );
      return mapUser(result.rows[0]);
    },

    async getUser(id) {
      const result = await client.query(
        "SELECT id, name, email, email_verified, image FROM users WHERE id = $1",
        [id]
      );
      if (result.rowCount === 0) return null;
      return mapUser(result.rows[0]);
    },

    async getUserByEmail(email) {
      const result = await client.query(
        "SELECT id, name, email, email_verified, image FROM users WHERE email = $1",
        [email]
      );
      if (result.rowCount === 0) return null;
      return mapUser(result.rows[0]);
    },

    async getUserByAccount({ providerAccountId, provider }) {
      const result = await client.query(
        `SELECT u.id, u.name, u.email, u.email_verified, u.image
         FROM users u
         JOIN accounts a ON u.id = a.user_id
         WHERE a.provider_account_id = $1 AND a.provider = $2`,
        [providerAccountId, provider]
      );
      if (result.rowCount === 0) return null;
      return mapUser(result.rows[0]);
    },

    async updateUser(user) {
      const { id, name, email, emailVerified, image } = user;
      const result = await client.query(
        `UPDATE users SET
           name = COALESCE($1, name),
           email = COALESCE($2, email),
           email_verified = COALESCE($3, email_verified),
           image = COALESCE($4, image)
         WHERE id = $5
         RETURNING id, name, email, email_verified, image`,
        [name, email, emailVerified, image, id]
      );
      return mapUser(result.rows[0]);
    },

    async deleteUser(userId) {
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
    },

    async linkAccount(account) {
      const { userId, provider, type, providerAccountId, scope } = account;
      // Handle both camelCase and snake_case from NextAuth
      const refreshToken = account.refresh_token || account.refreshToken;
      const accessToken = account.access_token || account.accessToken;
      const expiresAt = account.expires_at || account.expiresAt;
      const tokenType = account.token_type || account.tokenType;
      const idToken = account.id_token || account.idToken;
      const sessionState = account.session_state || account.sessionState;

      await client.query(
        `INSERT INTO accounts (
           user_id, provider, type, provider_account_id,
           refresh_token, access_token, expires_at, token_type,
           scope, id_token, session_state
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          userId, provider, type, providerAccountId,
          refreshToken, accessToken, expiresAt, tokenType,
          scope, idToken, sessionState,
        ]
      );
      return account;
    },

    async unlinkAccount({ providerAccountId, provider }) {
      await client.query(
        "DELETE FROM accounts WHERE provider_account_id = $1 AND provider = $2",
        [providerAccountId, provider]
      );
    },

    async createSession(session) {
      const { sessionToken, userId, expires } = session;
      await client.query(
        "INSERT INTO sessions (session_token, user_id, expires) VALUES ($1, $2, $3)",
        [sessionToken, userId, expires]
      );
      return session;
    },

    async getSessionAndUser(sessionToken) {
      const result = await client.query(
        `SELECT
           s.session_token, s.user_id, s.expires,
           u.id, u.name, u.email, u.email_verified, u.image
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.session_token = $1`,
        [sessionToken]
      );
      if (result.rowCount === 0) return null;
      const row = result.rows[0];
      return {
        session: {
          sessionToken: row.session_token,
          userId: row.user_id.toString(),
          expires: row.expires,
        },
        user: mapUser(row),
      };
    },

    async updateSession(session) {
      const { sessionToken, userId, expires } = session;
      if (!userId) {
        const result = await client.query(
          "UPDATE sessions SET expires = $1 WHERE session_token = $2 RETURNING session_token, user_id, expires",
          [expires, sessionToken]
        );
        if (result.rowCount === 0) return null;
        return {
          sessionToken: result.rows[0].session_token,
          userId: result.rows[0].user_id?.toString() || null,
          expires: result.rows[0].expires,
        };
      }
      const result = await client.query(
        "UPDATE sessions SET user_id = $1, expires = $2 WHERE session_token = $3 RETURNING session_token, user_id, expires",
        [userId, expires, sessionToken]
      );
      if (result.rowCount === 0) return null;
      return {
        sessionToken: result.rows[0].session_token,
        userId: result.rows[0].user_id.toString(),
        expires: result.rows[0].expires,
      };
    },

    async deleteSession(sessionToken) {
      await client.query("DELETE FROM sessions WHERE session_token = $1", [sessionToken]);
    },
  };
}

function mapUser(row) {
  return {
    id: row.id.toString(),
    name: row.name,
    email: row.email,
    emailVerified: row.email_verified,
    image: row.image,
  };
}
