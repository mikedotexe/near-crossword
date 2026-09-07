import { participantHandlers } from "@/src/server/base/participant-api";
export const runtime = "nodejs";
export const POST = participantHandlers.claim;
export const GET = participantHandlers.recovery;
