import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import EmailProvider from "next-auth/providers/email";
import { AsyncLocalStorage } from "node:async_hooks";
import { Resend } from "resend";
import PgAdapter from "../../../src/lib/pg-adapter";
import {
  clientAddress,
  enforceMagicLinkRateLimits,
} from "../../../src/server/v2/security";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const providers = [];
const requestContext = new AsyncLocalStorage();

function requestHeaders(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers || {})) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (typeof value === "string") {
      headers.set(name, value);
    }
  }
  return headers;
}

if (
  process.env.NEXTAUTH_GOOGLE_CLIENT_ID &&
  process.env.NEXTAUTH_GOOGLE_CLIENT_SECRET
) {
  providers.push(
    GoogleProvider({
      clientId: process.env.NEXTAUTH_GOOGLE_CLIENT_ID,
      clientSecret: process.env.NEXTAUTH_GOOGLE_CLIENT_SECRET,
      authorization: { params: { prompt: "select_account" } },
    })
  );
}

if (hasDatabase && process.env.RESEND_API_KEY) {
  providers.push(
    EmailProvider({
      from:
        process.env.NEXTAUTH_EMAIL_FROM ||
        "NEAR Crossword <noreply@crossword.xyz>",
      sendVerificationRequest: async ({ identifier: email, url }) => {
        const headers = requestContext.getStore();
        if (!headers) {
          throw new Error("Magic-link request context is unavailable");
        }
        const address = clientAddress({
          headers,
        });
        await enforceMagicLinkRateLimits(email, address);
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from:
            process.env.NEXTAUTH_EMAIL_FROM ||
            "NEAR Crossword <noreply@crossword.xyz>",
          to: email,
          subject: "Sign in to Crossword Campaigns",
          html: `<p>Click the link below to sign in:</p>
                 <p><a href="${url}">Sign in to Crossword Campaigns</a></p>
                 <p>This link expires in 1 hour.</p>
                 <p>If you didn't request this, you can safely ignore it.</p>`,
        });
      },
    })
  );
}

export const authOptions = {
  ...(hasDatabase ? { adapter: PgAdapter() } : {}),
  session: {
    strategy: hasDatabase ? "database" : "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/check-email",
  },
  providers,
  callbacks: {
    async signIn({ account, profile }) {
      // Google exposes the verification flag on the provider profile.
      if (
        account?.provider === "google" &&
        profile?.email_verified !== true
      ) {
        return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, user, token }) {
      if (session.user) {
        session.user.id = user?.id || token?.sub;
      }
      return session;
    },
  },
};

const authHandler = NextAuth(authOptions);

export default function handler(request, response) {
  return requestContext.run(
    requestHeaders(request),
    () => authHandler(request, response),
  );
}
