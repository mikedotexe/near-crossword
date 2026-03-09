import { TwitterApi } from "twitter-api-v2";
import config from "./config.js";
import type { TweetPuzzleParams } from "./types.js";

export async function tweetNewPuzzle({ txHash, rewardAmount, dimensions }: TweetPuzzleParams): Promise<void> {
  if (!config.twitterApiKey || !config.twitterAccessToken) return;

  const client = new TwitterApi({
    appKey: config.twitterApiKey,
    appSecret: config.twitterApiSecret,
    accessToken: config.twitterAccessToken,
    accessSecret: config.twitterAccessTokenSecret,
  });

  const puzzleUrl = config.crosswordUrl;
  const text = [
    `New crossword puzzle just dropped!`,
    `${dimensions.x}x${dimensions.y} grid, ${rewardAmount} NEAR reward`,
    `Play it: ${puzzleUrl}`,
  ].join("\n");

  await client.v2.tweet(text);
}
