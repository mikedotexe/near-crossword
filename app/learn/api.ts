export class LearningApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function learningApi<T>(
  path: string,
  body?: unknown,
  method = "POST",
  headers: Record<string, string> = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok)
      throw new LearningApiError(
        response.status,
        result?.error?.message || "This request could not be completed.",
      );
    return result as T;
  } catch (error) {
    if (error instanceof LearningApiError) throw error;
    throw new LearningApiError(
      0,
      "Connection interrupted. Refresh the saved state before retrying.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export function loginLink(path: string) {
  return `/login?callbackUrl=${encodeURIComponent(path)}`;
}
