import { describe, expect, it, vi } from "vitest";

import { createTwitterClient } from "../../src/services/twitter";

describe("createTwitterClient", () => {
  it("requests the user timeline with since_id and bearer auth", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ data: [{ id: "12" }] }),
    );
    const client = createTwitterClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: fetchMock as typeof fetch,
    });

    await expect(
      client.listUserPosts({
        accessToken: "access-token",
        sinceId: "10",
        userId: "user-id",
      }),
    ).resolves.toEqual([{ id: "12" }]);

    const [requestUrl, init] = fetchMock.mock.calls[0]!;
    const url = new URL(toRequestUrlString(requestUrl));
    expect(url.pathname).toBe("/2/users/user-id/tweets");
    expect(url.searchParams.get("since_id")).toBe("10");
    expect(url.searchParams.get("max_results")).toBe("100");
    expect(init?.headers).toEqual({
      authorization: "Bearer access-token",
    });
  });

  it("refreshes OAuth tokens with a form request", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        access_token: "new-access",
        expires_in: 7200,
        refresh_token: "new-refresh",
        scope: "tweet.read users.read offline.access",
        token_type: "bearer",
      }),
    );
    const client = createTwitterClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: fetchMock as typeof fetch,
      now: () => 1000,
    });

    await expect(client.refreshTokens("old-refresh")).resolves.toEqual({
      accessToken: "new-access",
      expiresAt: 7_201_000,
      refreshToken: "new-refresh",
      scope: "tweet.read users.read offline.access",
      tokenType: "bearer",
    });

    const [requestUrl, init] = fetchMock.mock.calls[0]!;
    expect(toRequestUrlString(requestUrl)).toBe("https://api.twitter.com/2/oauth2/token");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      authorization: `Basic ${btoa("client-id:client-secret")}`,
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    const body = init?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh");
  });

  it("builds an OAuth authorization URL and setup state", async () => {
    const client = createTwitterClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(),
      ) as typeof fetch,
      now: () => 1000,
    });

    const request = await client.createAuthorizationRequest("https://example.com/auth/callback");
    const url = new URL(request.url);

    expect(url.origin + url.pathname).toBe("https://twitter.com/i/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.com/auth/callback");
    expect(url.searchParams.get("scope")).toBe("tweet.read users.read offline.access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(request.setupState.state);
    expect(request.setupState.createdAt).toBe(1000);
    expect(request.setupState.codeVerifier.length).toBeGreaterThan(20);
  });
});

const jsonResponse = (body: unknown): Response => {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
  });
};

const toRequestUrlString = (request: RequestInfo | URL): string => {
  if (request instanceof URL) {
    return request.toString();
  }

  if (request instanceof Request) {
    return request.url;
  }

  return request;
};
