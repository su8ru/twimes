import type { OAuthSetupState, OAuthTokenSet } from "../domain/oauth";

export type TwimesStateStore = {
  getLastSeenPostId: () => Promise<string | undefined>;
  setLastSeenPostId: (postId: string) => Promise<void>;
  getOAuthTokens: () => Promise<OAuthTokenSet | undefined>;
  setOAuthTokens: (tokens: OAuthTokenSet) => Promise<void>;
  getOAuthSetupState: () => Promise<OAuthSetupState | undefined>;
  setOAuthSetupState: (state: OAuthSetupState) => Promise<void>;
  clearOAuthSetupState: () => Promise<void>;
};

const LAST_SEEN_POST_ID_KEY = "lastSeenPostId";
const OAUTH_TOKENS_KEY = "oauthTokens";
const OAUTH_SETUP_STATE_KEY = "oauthSetupState";

export const createDurableObjectTwimesStateStore = (
  storage: DurableObjectStorage,
): TwimesStateStore => {
  return {
    getLastSeenPostId: async () => {
      return await storage.get<string>(LAST_SEEN_POST_ID_KEY);
    },

    setLastSeenPostId: async (postId) => {
      await storage.put(LAST_SEEN_POST_ID_KEY, postId);
    },

    getOAuthTokens: async () => {
      return await storage.get<OAuthTokenSet>(OAUTH_TOKENS_KEY);
    },

    setOAuthTokens: async (tokens) => {
      await storage.put(OAUTH_TOKENS_KEY, tokens);
    },

    getOAuthSetupState: async () => {
      return await storage.get<OAuthSetupState>(OAUTH_SETUP_STATE_KEY);
    },

    setOAuthSetupState: async (state) => {
      await storage.put(OAUTH_SETUP_STATE_KEY, state);
    },

    clearOAuthSetupState: async () => {
      await storage.delete(OAUTH_SETUP_STATE_KEY);
    },
  };
};
