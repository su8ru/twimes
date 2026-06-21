import type { OAuthSetupState, OAuthTokenSet } from "../domain/oauth";
import type { Tweet } from "../domain/tweet";

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const API_BASE_URL = "https://api.x.com";
const OAUTH_SCOPES = ["tweet.read", "users.read", "offline.access"] as const;

export type TwitterClientConfig = {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  now?: () => number;
  recordApiCall?: (event: TwitterApiCallEvent) => void;
};

export type AuthorizationRequest = {
  setupState: OAuthSetupState;
  url: string;
};

export type TwitterService = {
  createAuthorizationRequest: (redirectUri: string) => Promise<AuthorizationRequest>;
  exchangeAuthorizationCode: (options: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }) => Promise<OAuthTokenSet>;
  refreshTokens: (refreshToken: string) => Promise<OAuthTokenSet>;
  listUserPosts: (options: {
    accessToken: string;
    sinceId?: string;
    userId: string;
  }) => Promise<Tweet[]>;
};

export type TwitterApiOperation =
  | "exchange_authorization_code"
  | "list_user_posts"
  | "refresh_tokens";

export type TwitterApiCallEvent = {
  durationMs: number;
  endpoint: string;
  errorMessage?: string;
  errorName?: string;
  event: "x_api_call";
  fetchedCount?: number;
  message: string;
  method: "GET" | "POST";
  ok: boolean;
  operation: TwitterApiOperation;
  service: "x";
  sinceId?: string;
  status?: number;
};

export const createTwitterClient = (config: TwitterClientConfig): TwitterService => {
  const clientFetch = config.fetch ?? fetch;
  const now = config.now ?? Date.now;

  const recordApiCall = (
    event: Omit<TwitterApiCallEvent, "event" | "message" | "service">,
  ): void => {
    config.recordApiCall?.({
      event: "x_api_call",
      message: event.ok ? "X API call completed" : "X API call failed",
      service: "x",
      ...event,
    });
  };

  const fetchTwitterApi = async (input: {
    endpoint: string;
    init?: RequestInit;
    method: "GET" | "POST";
    operation: TwitterApiOperation;
    sinceId?: string;
    url: string | URL;
  }): Promise<{ durationMs: number; response: Response }> => {
    const startedAt = now();

    try {
      const response = await clientFetch(input.url, input.init);
      return {
        durationMs: now() - startedAt,
        response,
      };
    } catch (error) {
      recordApiCall({
        durationMs: now() - startedAt,
        endpoint: input.endpoint,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
        method: input.method,
        ok: false,
        operation: input.operation,
        sinceId: input.sinceId,
      });
      throw error;
    }
  };

  const requestToken = async (input: {
    body: Record<string, string>;
    operation: Extract<TwitterApiOperation, "exchange_authorization_code" | "refresh_tokens">;
  }): Promise<OAuthTokenSet> => {
    const body = new URLSearchParams(input.body);
    const endpoint = "/2/oauth2/token";
    const method = "POST";
    const { durationMs, response } = await fetchTwitterApi({
      endpoint,
      init: {
        body,
        headers: {
          authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        method,
      },
      method,
      operation: input.operation,
      url: TOKEN_URL,
    });

    recordApiCall({
      durationMs,
      endpoint,
      method,
      ok: response.ok,
      operation: input.operation,
      status: response.status,
    });

    if (!response.ok) {
      throw new Error(`Twitter token request failed: ${response.status} ${await response.text()}`);
    }

    const tokenResponse = asTokenResponse(await response.json());
    return {
      accessToken: tokenResponse.access_token,
      expiresAt: now() + tokenResponse.expires_in * 1000,
      refreshToken: tokenResponse.refresh_token,
      scope: tokenResponse.scope,
      tokenType: tokenResponse.token_type,
    };
  };

  return {
    createAuthorizationRequest: async (redirectUri) => {
      const codeVerifier = randomBase64Url(32);
      const state = randomBase64Url(32);
      const codeChallenge = await sha256Base64Url(codeVerifier);
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");

      return {
        setupState: {
          codeVerifier,
          createdAt: now(),
          state,
        },
        url: url.toString(),
      };
    },

    exchangeAuthorizationCode: async (options) => {
      return await requestToken({
        body: {
          code: options.code,
          code_verifier: options.codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: options.redirectUri,
        },
        operation: "exchange_authorization_code",
      });
    },

    refreshTokens: async (refreshToken) => {
      return await requestToken({
        body: {
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        },
        operation: "refresh_tokens",
      });
    },

    listUserPosts: async (options) => {
      const endpoint = "/2/users/:id/tweets";
      const method = "GET";
      const url = new URL(`/2/users/${options.userId}/tweets`, API_BASE_URL);
      url.searchParams.set("max_results", "100");
      if (options.sinceId !== undefined) {
        url.searchParams.set("since_id", options.sinceId);
      }

      const { durationMs, response } = await fetchTwitterApi({
        endpoint,
        init: {
          headers: {
            authorization: `Bearer ${options.accessToken}`,
          },
        },
        method,
        operation: "list_user_posts",
        sinceId: options.sinceId,
        url,
      });

      if (!response.ok) {
        recordApiCall({
          durationMs,
          endpoint,
          method,
          ok: false,
          operation: "list_user_posts",
          sinceId: options.sinceId,
          status: response.status,
        });
        throw new Error(
          `Twitter timeline request failed: ${response.status} ${await response.text()}`,
        );
      }

      let body: TimelineResponse;
      try {
        body = asTimelineResponse(await response.json());
      } catch (error) {
        recordApiCall({
          durationMs,
          endpoint,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorName: error instanceof Error ? error.name : undefined,
          method,
          ok: false,
          operation: "list_user_posts",
          sinceId: options.sinceId,
          status: response.status,
        });
        throw error;
      }

      const tweets = body.data?.map((tweet) => ({ id: tweet.id })) ?? [];
      recordApiCall({
        durationMs,
        endpoint,
        fetchedCount: tweets.length,
        method,
        ok: true,
        operation: "list_user_posts",
        sinceId: options.sinceId,
        status: response.status,
      });
      return tweets;
    },
  };
};

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
  token_type: string;
};

type TimelineResponse = {
  data?: Tweet[];
};

const asTokenResponse = (value: unknown): TokenResponse => {
  if (!isRecord(value)) {
    throw new Error("Twitter token response was not an object.");
  }

  const accessToken = value["access_token"];
  const expiresIn = value["expires_in"];
  const refreshToken = value["refresh_token"];
  const scope = value["scope"];
  const tokenType = value["token_type"];

  if (
    typeof accessToken !== "string" ||
    typeof expiresIn !== "number" ||
    typeof refreshToken !== "string" ||
    typeof tokenType !== "string" ||
    (scope !== undefined && typeof scope !== "string")
  ) {
    throw new Error("Twitter token response had an unexpected shape.");
  }

  return {
    access_token: accessToken,
    expires_in: expiresIn,
    refresh_token: refreshToken,
    scope,
    token_type: tokenType,
  };
};

const asTimelineResponse = (value: unknown): TimelineResponse => {
  if (!isRecord(value)) {
    throw new Error("Twitter timeline response was not an object.");
  }

  const data = value["data"];
  if (data === undefined) {
    return {};
  }

  if (!Array.isArray(data)) {
    throw new Error("Twitter timeline response data was not an array.");
  }

  return {
    data: data.map((item) => {
      if (!isRecord(item) || typeof item["id"] !== "string") {
        throw new Error("Twitter timeline response tweet had an unexpected shape.");
      }

      return { id: item["id"] };
    }),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const randomBase64Url = (byteLength: number): string => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
};

const sha256Base64Url = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
};

const base64UrlEncode = (bytes: Uint8Array): string => {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
