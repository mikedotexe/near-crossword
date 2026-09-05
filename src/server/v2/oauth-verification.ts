import type { Pool } from "pg";
import { z } from "zod";
import { AppError } from "./errors";

const googleSignIn = z.object({
  user: z.object({ id: z.string().regex(/^[1-9][0-9]{0,18}$/), email: z.string().email() }),
  account: z.object({ provider: z.literal("google"), providerAccountId: z.string().min(1) }),
  profile: z.object({ sub: z.string().min(1), email: z.string().email(), email_verified: z.literal(true) }),
});

// Called only from NextAuth's server-side signIn event, after account linking.
export async function persistGoogleEmailVerification(pool: Pool, event: unknown) {
  const parsed = googleSignIn.safeParse(event);
  if (!parsed.success) return;
  const { user, account, profile } = parsed.data;
  const email = profile.email.trim().toLowerCase();
  if (profile.sub !== account.providerAccountId || user.email.trim().toLowerCase() !== email) return;
  try {
    await pool.query(
      `UPDATE users u SET email_verified = COALESCE(u.email_verified, NOW())
       WHERE u.id = $1 AND LOWER(TRIM(u.email)) = $2 AND EXISTS
         (SELECT 1 FROM accounts a WHERE a.user_id = u.id AND a.provider = 'google' AND a.provider_account_id = $3)`,
      [user.id, email, profile.sub]);
  } catch { throw new AppError(503, "EMAIL_VERIFICATION_UNAVAILABLE", "Email verification could not be recorded"); }
}
