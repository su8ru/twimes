export const EMBED_HOST = "fixupx.com";

export type Tweet = {
  id: string;
};

export const buildTweetUrl = (username: string, tweetId: string): string => {
  const normalizedUsername = username.replace(/^@/, "");
  return `https://${EMBED_HOST}/${normalizedUsername}/status/${tweetId}`;
};

export const sortTweetsAscending = <T extends Tweet>(tweets: readonly T[]): T[] => {
  return [...tweets].sort((left, right) => compareTweetIds(left.id, right.id));
};

export const getLatestTweetId = (tweets: readonly Tweet[]): string | undefined => {
  return tweets.reduce<string | undefined>((latestId, tweet) => {
    if (latestId === undefined) {
      return tweet.id;
    }

    return compareTweetIds(tweet.id, latestId) > 0 ? tweet.id : latestId;
  }, undefined);
};

const compareTweetIds = (left: string, right: string): number => {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);

  if (leftValue < rightValue) {
    return -1;
  }

  if (leftValue > rightValue) {
    return 1;
  }

  return 0;
};
