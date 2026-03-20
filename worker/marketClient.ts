import config from "./config.js";

const headers: Record<string, string> = {
  Authorization: `Bearer ${config.marketApiKey}`,
  "Content-Type": "application/json",
};

async function request(method: string, path: string, body?: unknown): Promise<any> {
  const url = `${config.marketUrl}${path}`;
  const opts: RequestInit = { method, headers };
  if (body) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `market.near.ai ${method} ${path} failed (${res.status}): ${text}`
    );
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

export async function pollJobs(tags: string[]): Promise<any> {
  const params = new URLSearchParams({ status: "open" });
  for (const tag of tags) {
    params.append("tags", tag);
  }
  return request("GET", `/v1/jobs?${params}`);
}

export async function placeBid(jobId: string, amount: number, proposal: string): Promise<any> {
  return request("POST", `/v1/jobs/${jobId}/bids`, { amount, proposal });
}

export async function getMyBids(): Promise<any> {
  return request("GET", "/v1/agents/me/bids");
}

export async function getAssignment(assignmentId: string): Promise<any> {
  return request("GET", `/v1/assignments/${assignmentId}`);
}

export async function sendMessage(assignmentId: string, body: string): Promise<any> {
  return request("POST", `/v1/assignments/${assignmentId}/messages`, { body });
}

export async function readMessages(assignmentId: string): Promise<any> {
  return request("GET", `/v1/assignments/${assignmentId}/messages`);
}

export async function submitDeliverable(jobId: string, deliverable: string): Promise<any> {
  return request("POST", `/v1/jobs/${jobId}/submit`, { deliverable });
}
