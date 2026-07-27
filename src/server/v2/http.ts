import { randomUUID } from "node:crypto";
import { AppError, asAppError } from "./errors";

export interface RouteContext<TParams extends Record<string, string> = Record<string, string>> {
  params: Promise<TParams>;
}

export type DynamicRouteHandler<TParams extends Record<string, string>> = (
  request: Request,
  context: RouteContext<TParams>,
) => Promise<Response>;

export function withErrors(
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response>;
export function withErrors<TParams extends Record<string, string>>(
  handler: DynamicRouteHandler<TParams>,
): DynamicRouteHandler<TParams>;
export function withErrors(
  handler:
    | ((request: Request) => Promise<Response>)
    | DynamicRouteHandler<Record<string, string>>,
):
  | ((request: Request) => Promise<Response>)
  | DynamicRouteHandler<Record<string, string>> {
  return async (request: Request, context?: RouteContext) => {
    const requestId = request.headers.get("x-request-id")?.slice(0, 128) || randomUUID();
    try {
      const response = await (
        handler as (
          request: Request,
          context?: RouteContext,
        ) => Promise<Response>
      )(request, context);
      response.headers.set("x-request-id", requestId);
      response.headers.set("cache-control", response.headers.get("cache-control") || "no-store");
      response.headers.set("x-content-type-options", "nosniff");
      return response;
    } catch (error) {
      const appError = asAppError(error);
      if (appError.status >= 500) {
        console.error(`[v2:${requestId}] ${appError.code}: ${appError.message}`);
      }
      return json(
        {
          error: {
            code: appError.code,
            message:
              appError.status >= 500 && appError.code === "INTERNAL_ERROR"
                ? "Internal server error"
                : appError.message,
            ...(appError.details === undefined ? {} : { details: appError.details }),
          },
          requestId,
        },
        appError.status,
        { "x-request-id": requestId },
      );
    }
  };
}

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export async function readJson(
  request: Request,
  maxBytes = 256 * 1024,
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    throw new AppError(413, "PAYLOAD_TOO_LARGE", `Request exceeds ${maxBytes} bytes`);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new AppError(413, "PAYLOAD_TOO_LARGE", `Request exceeds ${maxBytes} bytes`);
  }
  if (!text) throw new AppError(400, "INVALID_JSON", "Request body is required");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

export async function pathParam(context: RouteContext, name: string): Promise<string> {
  const params = await context.params;
  const value = params[name];
  if (!value) throw new AppError(400, "MISSING_PATH_PARAMETER", `${name} is required`);
  return value;
}
