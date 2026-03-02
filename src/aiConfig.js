const parseBoolean = (value) => String(value).toLowerCase() === "true";

const aiConfig = {
  enabled: parseBoolean(process.env.NEXT_PUBLIC_NEAR_AI_ENABLED || "false"),
  marketUrl:
    process.env.NEXT_PUBLIC_MARKET_NEAR_AI_URL || "https://market.near.ai",
  agentId: process.env.NEXT_PUBLIC_NEAR_AI_AGENT_ID || "",
};

export default aiConfig;
