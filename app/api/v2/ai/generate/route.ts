import { AnthropicAiGenerator, parseAiGenerationInput } from "../../../../../src/server/v2/ai";
import { readJson, withErrors } from "../../../../../src/server/v2/http";
import { getRepository } from "../../../../../src/server/v2/repository-factory";
import { clientAddress, enforceRateLimit } from "../../../../../src/server/v2/security";
import { paidAiGeneration } from "../../../../../src/server/v2/x402-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrors(async (request) => {
  await enforceRateLimit(`ai:${clientAddress(request)}`, {
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  const body = await readJson(request, 64 * 1024);
  const input = parseAiGenerationInput(body);
  return paidAiGeneration(
    request,
    body,
    input,
    getRepository(),
    new AnthropicAiGenerator(),
  );
});
