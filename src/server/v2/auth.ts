import { createHash } from "node:crypto";
import { AppError } from "./errors";
import { getDatabasePool } from "./repository-factory";
import { isExplicitMockMode } from "./config";
import type { Actor } from "./types";
import { clientAddress } from "./security";

function cookies(request: Request): Map<string, string> {
  const result = new Map<string, string>();
  for (const section of (request.headers.get("cookie") || "").split(";")) {
    const index = section.indexOf("=");
    if (index <= 0) continue;
    result.set(
      section.slice(0, index).trim(),
      decodeURIComponent(section.slice(index + 1).trim()),
    );
  }
  return result;
}

export async function optionalActor(request: Request): Promise<Actor | null> {
  if (isExplicitMockMode()) {
    const demoId = request.headers.get("x-demo-user-id");
    if (demoId) {
      if (!/^[A-Za-z0-9@._-]{3,128}$/.test(demoId)) {
        throw new AppError(400, "INVALID_DEMO_USER", "x-demo-user-id is invalid");
      }
      return { id: `demo:${demoId}`, email: demoId.includes("@") ? demoId : null, demo: true };
    }
  }
  if (!process.env.DATABASE_URL) return null;
  const jar = cookies(request);
  const token =
    jar.get("__Secure-next-auth.session-token") ?? jar.get("next-auth.session-token");
  if (!token) return null;
  const result = await getDatabasePool().query(
    `SELECT u.id::TEXT, u.email
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.session_token = $1 AND s.expires > NOW()
     LIMIT 1`,
    [token],
  );
  if (!result.rowCount) return null;
  return { id: result.rows[0].id, email: result.rows[0].email, demo: false };
}

export async function requireActor(request: Request): Promise<Actor> {
  const actor = await optionalActor(request);
  if (!actor) throw new AppError(401, "AUTH_REQUIRED", "Creator sign-in is required");
  return actor;
}

export function anonymousActorId(request: Request): string {
  const source = `${clientAddress(request)}:${request.headers.get("user-agent") || ""}`;
  return `anonymous:${createHash("sha256").update(source).digest("hex").slice(0, 24)}`;
}
