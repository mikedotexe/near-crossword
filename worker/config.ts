import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "..", ".env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const workerConfig = {
  // market.near.ai
  marketApiKey: required("MARKET_API_KEY"),
  marketUrl: process.env.MARKET_URL || "https://market.near.ai",
  matchTags: (process.env.MATCH_TAGS || "crossword,puzzle,education,marketing")
    .split(",")
    .map((t) => t.trim()),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "60000", 10),

  // Claude API
  anthropicApiKey: required("ANTHROPIC_API_KEY"),

  // NEAR
  nearAccountId:
    process.env.NEAR_ACCOUNT_ID || "crossword.puzzle.near",
  nearPrivateKey: required("NEAR_PRIVATE_KEY"),
  nearNetwork: process.env.NEAR_NETWORK || "mainnet",
  nearNodeUrl:
    (process.env.NEAR_NETWORK || "mainnet") === "mainnet"
      ? "https://rpc.mainnet.fastnear.com"
      : "https://rpc.testnet.fastnear.com",

  // Crossword viewer
  crosswordUrl: process.env.CROSSWORD_URL || "https://crossword.xyz",

  // Twitter/X (optional — skip tweeting if any are missing)
  twitterApiKey: process.env.TWITTER_API_KEY || "",
  twitterApiSecret: process.env.TWITTER_API_SECRET || "",
  twitterAccessToken: process.env.TWITTER_ACCESS_TOKEN || "",
  twitterAccessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET || "",
};

export default workerConfig;
