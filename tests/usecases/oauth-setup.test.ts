import { describe, expect, it } from "vitest";

import type { OAuthSetupState, OAuthTokenSet } from "../../src/domain/oauth";
import type { TwimesStateStore } from "../../src/state/twimes-state";
import {
  completeOAuthSetup,
  OAuthSetupError,
  startOAuthSetup,
} from "../../src/usecases/oauth-setup";

const NOW = 1_800_000_000_000;

describe("startOAuthSetup", () => {
  it("stores setup state and returns the authorization redirect URL", async () => {
    const state = createInMemoryStateStore();
    const twitter = createFakeOAuthClient();

    const result = await startOAuthSetup({
      expectedSetupToken: "setup-token",
      providedSetupToken: "setup-token",
      redirectUri: "https://example.com/auth/callback",
      state,
      twitter,
    });

    expect(result).toEqual({ redirectUrl: "https://twitter.com/oauth" });
    expect(await state.getOAuthSetupState()).toEqual(setupState());
    expect(twitter.calls).toEqual(["authorize:https://example.com/auth/callback"]);
  });

  it("rejects an invalid setup token", async () => {
    const state = createInMemoryStateStore();
    const twitter = createFakeOAuthClient();

    await expect(
      startOAuthSetup({
        expectedSetupToken: "setup-token",
        providedSetupToken: "wrong-token",
        redirectUri: "https://example.com/auth/callback",
        state,
        twitter,
      }),
    ).rejects.toMatchObject(new OAuthSetupError("Unauthorized", 401));

    expect(await state.getOAuthSetupState()).toBeUndefined();
    expect(twitter.calls).toEqual([]);
  });
});

describe("completeOAuthSetup", () => {
  it("exchanges the callback code, stores tokens, and clears setup state", async () => {
    const state = createInMemoryStateStore({ setupState: setupState() });
    const twitter = createFakeOAuthClient();

    await completeOAuthSetup({
      code: "callback-code",
      now: () => NOW,
      receivedState: "oauth-state",
      redirectUri: "https://example.com/auth/callback",
      state,
      twitter,
    });

    expect(await state.getOAuthTokens()).toEqual(tokenSet());
    expect(await state.getOAuthSetupState()).toBeUndefined();
    expect(twitter.calls).toEqual([
      "exchange:callback-code:code-verifier:https://example.com/auth/callback",
    ]);
  });

  it("rejects missing callback parameters", async () => {
    await expect(
      completeOAuthSetup({
        code: null,
        now: () => NOW,
        receivedState: "oauth-state",
        redirectUri: "https://example.com/auth/callback",
        state: createInMemoryStateStore({ setupState: setupState() }),
        twitter: createFakeOAuthClient(),
      }),
    ).rejects.toMatchObject(new OAuthSetupError("Missing OAuth callback parameters", 400));
  });

  it("rejects when setup state is missing", async () => {
    await expect(
      completeOAuthSetup({
        code: "callback-code",
        now: () => NOW,
        receivedState: "oauth-state",
        redirectUri: "https://example.com/auth/callback",
        state: createInMemoryStateStore(),
        twitter: createFakeOAuthClient(),
      }),
    ).rejects.toMatchObject(
      new OAuthSetupError("OAuth setup state was not found. Start again from /auth/start.", 400),
    );
  });

  it("rejects OAuth state mismatch without clearing setup state", async () => {
    const state = createInMemoryStateStore({ setupState: setupState() });

    await expect(
      completeOAuthSetup({
        code: "callback-code",
        now: () => NOW,
        receivedState: "wrong-state",
        redirectUri: "https://example.com/auth/callback",
        state,
        twitter: createFakeOAuthClient(),
      }),
    ).rejects.toMatchObject(new OAuthSetupError("OAuth state mismatch", 400));

    expect(await state.getOAuthSetupState()).toEqual(setupState());
  });

  it("clears expired setup state and rejects", async () => {
    const state = createInMemoryStateStore({
      setupState: setupState({ createdAt: NOW - 10 * 60 * 1000 - 1 }),
    });

    await expect(
      completeOAuthSetup({
        code: "callback-code",
        now: () => NOW,
        receivedState: "oauth-state",
        redirectUri: "https://example.com/auth/callback",
        state,
        twitter: createFakeOAuthClient(),
      }),
    ).rejects.toMatchObject(
      new OAuthSetupError("OAuth setup state expired. Start again from /auth/start.", 400),
    );

    expect(await state.getOAuthSetupState()).toBeUndefined();
  });
});

type FakeOAuthClient = {
  calls: string[];
  createAuthorizationRequest: (redirectUri: string) => Promise<{
    setupState: OAuthSetupState;
    url: string;
  }>;
  exchangeAuthorizationCode: (options: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }) => Promise<OAuthTokenSet>;
};

const createFakeOAuthClient = (): FakeOAuthClient => {
  const calls: string[] = [];

  return {
    calls,

    createAuthorizationRequest: async (redirectUri) => {
      calls.push(`authorize:${redirectUri}`);
      return {
        setupState: setupState(),
        url: "https://twitter.com/oauth",
      };
    },

    exchangeAuthorizationCode: async (options) => {
      calls.push(`exchange:${options.code}:${options.codeVerifier}:${options.redirectUri}`);
      return tokenSet();
    },
  };
};

const createInMemoryStateStore = (
  initialState: { setupState?: OAuthSetupState; tokens?: OAuthTokenSet } = {},
): TwimesStateStore => {
  const mutableState: {
    lastSeenPostId: string | undefined;
    setupState: OAuthSetupState | undefined;
    tokens: OAuthTokenSet | undefined;
  } = {
    lastSeenPostId: undefined,
    setupState: initialState.setupState,
    tokens: initialState.tokens,
  };

  return {
    getLastSeenPostId: async () => {
      return mutableState.lastSeenPostId;
    },

    setLastSeenPostId: async (postId) => {
      mutableState.lastSeenPostId = postId;
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

const setupState = (overrides: Partial<OAuthSetupState> = {}): OAuthSetupState => {
  return {
    codeVerifier: "code-verifier",
    createdAt: NOW,
    state: "oauth-state",
    ...overrides,
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
