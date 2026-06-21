import { describe, expect, it } from "vitest";

import type { OAuthSetupState, OAuthTokenSet } from "../../src/domain/oauth";
import type { TwimesStateStore } from "../../src/state/twimes-state";
import {
  pollAndForward,
  type DiscordForwarder,
  type TwitterTimelineClient,
} from "../../src/usecases/poll-and-forward";

const NOW = 1_800_000_000_000;

describe("pollAndForward", () => {
  it("initializes last seen id without forwarding on the first poll", async () => {
    const state = createInMemoryStateStore();
    const discord = createFakeDiscordForwarder();
    const twitter = createFakeTwitterClient([{ id: "3" }, { id: "1" }, { id: "2" }]);

    const result = await runPoll({ discord, state, twitter });

    expect(result).toEqual({ forwardedCount: 0, initialized: true });
    expect(discord.sentUrls).toEqual([]);
    expect(await state.getLastSeenPostId()).toBe("3");
  });

  it("forwards new tweets from oldest to newest and advances state after each success", async () => {
    const state = createInMemoryStateStore({ lastSeenPostId: "10" });
    const discord = createFakeDiscordForwarder();
    const twitter = createFakeTwitterClient([{ id: "13" }, { id: "11" }, { id: "12" }]);

    const result = await runPoll({ discord, state, twitter });

    expect(result).toEqual({ forwardedCount: 3, initialized: false });
    expect(discord.sentUrls).toEqual([
      "https://fixupx.com/su8ru/status/11",
      "https://fixupx.com/su8ru/status/12",
      "https://fixupx.com/su8ru/status/13",
    ]);
    expect(state.lastSeenHistory).toEqual(["11", "12", "13"]);
    expect(await state.getLastSeenPostId()).toBe("13");
  });

  it("stops on Discord failure and keeps state at the last successful tweet", async () => {
    const state = createInMemoryStateStore({ lastSeenPostId: "10" });
    const discord = createFakeDiscordForwarder({
      failOnUrl: "https://fixupx.com/su8ru/status/12",
    });
    const twitter = createFakeTwitterClient([{ id: "13" }, { id: "11" }, { id: "12" }]);

    await expect(runPoll({ discord, state, twitter })).rejects.toThrow("Discord failed");

    expect(discord.sentUrls).toEqual([
      "https://fixupx.com/su8ru/status/11",
      "https://fixupx.com/su8ru/status/12",
    ]);
    expect(state.lastSeenHistory).toEqual(["11"]);
    expect(await state.getLastSeenPostId()).toBe("11");
  });

  it("does nothing when Twitter returns no tweets", async () => {
    const state = createInMemoryStateStore({ lastSeenPostId: "10" });
    const discord = createFakeDiscordForwarder();
    const twitter = createFakeTwitterClient([]);

    const result = await runPoll({ discord, state, twitter });

    expect(result).toEqual({ forwardedCount: 0, initialized: false });
    expect(discord.sentUrls).toEqual([]);
    expect(await state.getLastSeenPostId()).toBe("10");
  });

  it("refreshes expired tokens, stores them, and then calls the timeline", async () => {
    const state = createInMemoryStateStore({
      lastSeenPostId: "10",
      tokens: tokenSet({ accessToken: "old-access", expiresAt: NOW - 1 }),
    });
    const twitter = createFakeTwitterClient([], {
      refreshedTokens: tokenSet({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: NOW + 3_600_000,
      }),
    });

    await runPoll({ state, twitter });

    expect(await state.getOAuthTokens()).toEqual(
      tokenSet({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: NOW + 3_600_000,
      }),
    );
    expect(twitter.calls).toEqual(["refresh:refresh", "list:user-id:10:new-access"]);
  });
});

const runPoll = async (options: {
  discord?: DiscordForwarder;
  state: TwimesStateStore;
  twitter: TwitterTimelineClient;
}) => {
  return await pollAndForward({
    config: {
      now: () => NOW,
      refreshBeforeMs: 60_000,
      twitterUserId: "user-id",
      twitterUsername: "su8ru",
    },
    discord: options.discord ?? createFakeDiscordForwarder(),
    state: options.state,
    twitter: options.twitter,
  });
};

type FakeTwitterClient = TwitterTimelineClient & {
  calls: string[];
};

const createFakeTwitterClient = (
  tweets: { id: string }[],
  options: { refreshedTokens?: OAuthTokenSet } = {},
): FakeTwitterClient => {
  const calls: string[] = [];

  return {
    calls,

    listUserPosts: async (listOptions) => {
      calls.push(
        `list:${listOptions.userId}:${listOptions.sinceId ?? ""}:${listOptions.accessToken}`,
      );
      return tweets;
    },

    refreshTokens: async (refreshToken) => {
      calls.push(`refresh:${refreshToken}`);
      return options.refreshedTokens ?? tokenSet();
    },
  };
};

type FakeDiscordForwarder = DiscordForwarder & {
  sentUrls: string[];
};

const createFakeDiscordForwarder = (options: { failOnUrl?: string } = {}): FakeDiscordForwarder => {
  const sentUrls: string[] = [];

  return {
    sentUrls,

    sendTweetUrl: async (url) => {
      sentUrls.push(url);
      if (url === options.failOnUrl) {
        throw new Error("Discord failed");
      }
    },
  };
};

type InMemoryStateStore = TwimesStateStore & {
  lastSeenHistory: string[];
};

const createInMemoryStateStore = (
  initialState: { lastSeenPostId?: string; tokens?: OAuthTokenSet } = {},
): InMemoryStateStore => {
  const lastSeenHistory: string[] = [];
  const mutableState: {
    lastSeenPostId: string | undefined;
    setupState: OAuthSetupState | undefined;
    tokens: OAuthTokenSet | undefined;
  } = {
    lastSeenPostId: initialState.lastSeenPostId,
    setupState: undefined,
    tokens: initialState.tokens ?? tokenSet(),
  };

  return {
    lastSeenHistory,

    getLastSeenPostId: async () => {
      return mutableState.lastSeenPostId;
    },

    setLastSeenPostId: async (postId) => {
      mutableState.lastSeenPostId = postId;
      lastSeenHistory.push(postId);
    },

    getOAuthTokens: async () => {
      return mutableState.tokens;
    },

    setOAuthTokens: async (nextTokens) => {
      mutableState.tokens = nextTokens;
    },

    getOAuthSetupState: async () => {
      return mutableState.setupState;
    },

    setOAuthSetupState: async (nextSetupState) => {
      mutableState.setupState = nextSetupState;
    },

    clearOAuthSetupState: async () => {
      mutableState.setupState = undefined;
    },
  };
};

const tokenSet = (overrides: Partial<OAuthTokenSet> = {}): OAuthTokenSet => {
  return {
    accessToken: "access",
    expiresAt: NOW + 3_600_000,
    refreshToken: "refresh",
    tokenType: "bearer",
    ...overrides,
  };
};
