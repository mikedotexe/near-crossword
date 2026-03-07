import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import EmailProvider from "next-auth/providers/email";
import { Resend } from "resend";
import PgAdapter from "../../../src/lib/pg-adapter";

export const authOptions = {
  adapter: PgAdapter(),
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/login",
    verifyRequest: "/check-email",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.NEXTAUTH_GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.NEXTAUTH_GOOGLE_CLIENT_SECRET || "",
      authorization: { params: { prompt: "select_account" } },
    }),
    EmailProvider({
      from: process.env.NEXTAUTH_EMAIL_FROM || "NEAR Crossword <noreply@crossword.xyz>",
      sendVerificationRequest: async ({ identifier: email, url }) => {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
          console.log(`[auth] Magic link for ${email}: ${url}`);
          return;
        }
        const resend = new Resend(apiKey);
        await resend.emails.send({
          from: process.env.NEXTAUTH_EMAIL_FROM || "NEAR Crossword <noreply@crossword.xyz>",
          to: email,
          subject: "Sign in to NEAR Crossword",
          html: `<p>Click the link below to sign in:</p>
                 <p><a href="${url}">Sign in to NEAR Crossword</a></p>
                 <p>This link expires in 1 hour.</p>
                 <p>If you didn't request this, you can safely ignore it.</p>`,
        });
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Reject Google accounts with unverified emails
      if (account?.provider === "google" && !user.emailVerified && !user.email_verified) {
        return false;
      }
      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
};

export default NextAuth(authOptions);
