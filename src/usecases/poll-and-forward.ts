import type { OAuthTokenSet } from "../domain/oauth";
import { buildTweetUrl, getLatestTweetId, sortTweetsAscending, type Tweet } from "../domain/tweet";
import type { TwimesStateStore } from "../state/twimes-state";

export type TwitterTimelineClient = {
  listUserPosts: (options: {
    accessToken: string;
    sinceId?: string;
    userId: string;
  }) => Promise<Tweet[]>;
  refreshTokens: (refreshToken: string) => Promise<OAuthTokenSet>;
};

export type DiscordForwarder = {
  sendTweetUrl: (url: string) => Promise<void>;
};

export type PollAndForwardConfig = {
  now: () => number;
  refreshBeforeMs: number;
  twitterUserId: string;
  twitterUsername: string;
};

export type PollAndForwardResult = {
  forwardedCount: number;
  initialized: boolean;
};

export const pollAndForward = async (input: {
  config: PollAndForwardConfig;
  discord: DiscordForwarder;
  state: TwimesStateStore;
  twitter: TwitterTimelineClient;
}): Promise<PollAndForwardResult> => {
  const tokens = await getUsableTokens(input);
  const lastSeenPostId = await input.state.getLastSeenPostId();
  const tweets = await input.twitter.listUserPosts({
    accessToken: tokens.accessToken,
    sinceId: lastSeenPostId,
    userId: input.config.twitterUserId,
  });

  if (tweets.length === 0) {
    return {
      forwardedCount: 0,
      initialized: false,
    };
  }

  if (lastSeenPostId === undefined) {
    const latestTweetId = getLatestTweetId(tweets);
    if (latestTweetId !== undefined) {
      await input.state.setLastSeenPostId(latestTweetId);
    }

    return {
      forwardedCount: 0,
      initialized: true,
    };
  }

  const forwardedCount = await sortTweetsAscending(tweets).reduce<Promise<number>>(
    async (previousCount, tweet) => {
      const count = await previousCount;
      await input.discord.sendTweetUrl(buildTweetUrl(input.config.twitterUsername, tweet.id));
      await input.state.setLastSeenPostId(tweet.id);
      return count + 1;
    },
    Promise.resolve(0),
  );

  return {
    forwardedCount,
    initialized: false,
  };
};

const getUsableTokens = async (input: {
  config: PollAndForwardConfig;
  state: TwimesStateStore;
  twitter: TwitterTimelineClient;
}): Promise<OAuthTokenSet> => {
  const tokens = await input.state.getOAuthTokens();
  if (tokens === undefined) {
    throw new Error("Twitter OAuth tokens are not configured. Open /auth/start first.");
  }

  if (tokens.expiresAt > input.config.now() + input.config.refreshBeforeMs) {
    return tokens;
  }

  const refreshedTokens = await input.twitter.refreshTokens(tokens.refreshToken);
  await input.state.setOAuthTokens(refreshedTokens);
  return refreshedTokens;
};
