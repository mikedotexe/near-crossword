import { z } from "zod";
import { AppError } from "../v2/errors";
import { json, pathParam, withErrors } from "../v2/http";
import { getDatabasePool } from "../v2/repository-factory";
import { clientAddress, enforceRateLimit } from "../v2/security";
import {
  baseDeploymentFromEnvironment,
  RpcBaseChainReader,
} from "./chain-reader";
import { BaseRewardIssuer } from "./issuer";
import { readParticipantJson } from "./participant-api";
import { LearningPublication } from "./publication";
import { ReconciledBaseChainReader } from "./reconciled-chain-reader";
import { reviewContext } from "./review-api";

const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const expectation = z
  .object({
    revision: z.number().int().positive(),
    termsHash: hash,
    layoutHash: hash,
  })
  .strict();
const mutation = z
  .object({
    action: z.enum(["approve-layout", "bind", "publish", "withdraw"]),
    expected: expectation,
    onChainId: z
      .string()
      .regex(/^[1-9][0-9]{0,77}$/)
      .optional(),
  })
  .strict();

function chain() {
  return new ReconciledBaseChainReader(
    getDatabasePool(),
    new RpcBaseChainReader(baseDeploymentFromEnvironment()),
  );
}
function gate() {
  if (process.env.BASE_PUBLICATION_ENABLED !== "true")
    throw new AppError(404, "NOT_FOUND", "Not found");
}

export const publicationHandlers = {
  preview: withErrors<{ id: string }>(async (request, context) => {
    const { ownerId } = await reviewContext(request);
    await enforceRateLimit(`base-layout:owner:${ownerId}`, {
      limit: 120,
      windowMs: 3600000,
    });
    await enforceRateLimit(`base-layout:ip:${clientAddress(request)}`, {
      limit: 300,
      windowMs: 3600000,
    });
    return json(
      await new LearningPublication(getDatabasePool()).preview(
        ownerId,
        await pathParam(context, "id"),
      ),
    );
  }),
  update: withErrors<{ id: string }>(async (request, context) => {
    const { ownerId } = await reviewContext(request);
    const parsed = mutation.safeParse(await readParticipantJson(request));
    if (!parsed.success)
      throw new AppError(
        400,
        "INVALID_PUBLICATION",
        "Provide the reviewed publication commitments and action",
      );
    const { action, expected, onChainId } = parsed.data;
    const id = await pathParam(context, "id");
    const repository = new LearningPublication(
      getDatabasePool(),
      action === "publish" ? chain() : undefined,
    );
    if (action === "approve-layout")
      return json(await repository.approveLayout(ownerId, id, expected));
    if (action === "withdraw")
      return json(await repository.withdraw(ownerId, id, expected));
    if (action === "publish") {
      gate();
      return json(await repository.publish(ownerId, id, expected));
    }
    const preview = await repository.preview(ownerId, id);
    if (
      !preview.approved ||
      preview.revision !== expected.revision ||
      preview.termsHash !== expected.termsHash ||
      preview.layoutHash !== expected.layoutHash ||
      !onChainId
    ) {
      throw new AppError(
        409,
        "LAYOUT_REVIEW_REQUIRED",
        "Approve the current layout and provide the funded campaign number",
      );
    }
    const bound = await new BaseRewardIssuer(
      getDatabasePool(),
      chain(),
    ).bindApprovedCampaign(ownerId, id, BigInt(onChainId), expected);
    return json({ ...bound, onChainId: bound.onChainId.toString() });
  }),
  list: withErrors(async (request) => {
    gate();
    await enforceRateLimit(`base-lessons:ip:${clientAddress(request)}`, {
      limit: 300,
      windowMs: 3600000,
    });
    return json({
      lessons: await new LearningPublication(getDatabasePool()).list(),
    });
  }),
  get: withErrors<{ id: string }>(async (request, context) => {
    gate();
    await enforceRateLimit(`base-lessons:ip:${clientAddress(request)}`, {
      limit: 300,
      windowMs: 3600000,
    });
    return json(
      await new LearningPublication(getDatabasePool(), chain()).get(
        await pathParam(context, "id"),
      ),
    );
  }),
};
