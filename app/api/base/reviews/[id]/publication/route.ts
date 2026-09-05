import { publicationHandlers } from "../../../../../../src/server/base/publication-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = publicationHandlers.preview;
export const POST = publicationHandlers.update;
