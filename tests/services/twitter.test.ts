import { describe, expect, it, vi } from "vitest";

import { createTwitterClient, type TwitterApiCallEvent } from "../../src/services/twitter";

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

  it("records a successful timeline API call", async () => {
    let now = 1000;
    const records: TwitterApiCallEvent[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      now = 1250;
      return jsonResponse({ data: [{ id: "12" }] });
    });
    const client = createTwitterClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: fetchMock as typeof fetch,
      now: () => now,
      recordApiCall: (event) => records.push(event),
    });

    await client.listUserPosts({
      accessToken: "access-token",
      sinceId: "10",
      userId: "user-id",
    });

    expect(records).toEqual([
      {
        durationMs: 250,
        endpoint: "/2/users/:id/tweets",
        event: "x_api_call",
        method: "GET",
        ok: true,
        operation: "list_user_posts",
        service: "x",
        status: 200,
      },
    ]);
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
    expect(toRequestUrlString(requestUrl)).toBe("https://api.x.com/2/oauth2/token");
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

  it("records a successful token refresh API call", async () => {
    let now = 1000;
    const records: TwitterApiCallEvent[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      now = 1100;
      return jsonResponse({
        access_token: "new-access",
        expires_in: 7200,
        refresh_token: "new-refresh",
        token_type: "bearer",
      });
    });
    const client = createTwitterClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: fetchMock as typeof fetch,
      now: () => now,
      recordApiCall: (event) => records.push(event),
    });

    await client.refreshTokens("old-refresh");

    expect(records).toEqual([
      {
        durationMs: 100,
        endpoint: "/2/oauth2/token",
        event: "x_api_call",
        method: "POST",
        ok: true,
        operation: "refresh_tokens",
        service: "x",
        status: 200,
      },
    ]);
  });

  it("records a successful authorization code exchange API call", async () => {
    const records: TwitterApiCallEvent[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        access_token: "access-token",
        expires_in: 7200,
        refresh_token: "refresh-token",
        token_type: "bearer",
      }),
    );
    const client = createTwitterClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: fetchMock as typeof fetch,
      now: () => 1000,
      recordApiCall: (event) => records.push(event),
    });

    await client.exchangeAuthorizationCode({
      code: "code",
      codeVerifier: "verifier",
      redirectUri: "https://example.com/auth/callback",
    });

    expect(records).toEqual([
      {
        durationMs: 0,
        endpoint: "/2/oauth2/token",
        event: "x_api_call",
        method: "POST",
        ok: true,
        operation: "exchange_authorization_code",
        service: "x",
        status: 200,
      },
    ]);
  });

  it("records a failed API response before throwing", async () => {
    const records: TwitterApiCallEvent[] = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("rate limited", { status: 429 }),
    );
    const client = createTwitterClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: fetchMock as typeof fetch,
      now: () => 1000,
      recordApiCall: (event) => records.push(event),
    });

    await expect(
      client.listUserPosts({
        accessToken: "access-token",
        userId: "user-id",
      }),
    ).rejects.toThrow("Twitter timeline request failed: 429 rate limited");

    expect(records).toEqual([
      {
        durationMs: 0,
        endpoint: "/2/users/:id/tweets",
        event: "x_api_call",
        method: "GET",
        ok: false,
        operation: "list_user_posts",
        service: "x",
        status: 429,
      },
    ]);
  });

  it("records a failed fetch before rethrowing", async () => {
    const records: TwitterApiCallEvent[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      throw new TypeError("network failed");
    });
    const client = createTwitterClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: fetchMock as typeof fetch,
      now: () => 1000,
      recordApiCall: (event) => records.push(event),
    });

    await expect(
      client.listUserPosts({
        accessToken: "access-token",
        userId: "user-id",
      }),
    ).rejects.toThrow("network failed");

    expect(records).toEqual([
      {
        durationMs: 0,
        endpoint: "/2/users/:id/tweets",
        errorMessage: "network failed",
        errorName: "TypeError",
        event: "x_api_call",
        method: "GET",
        ok: false,
        operation: "list_user_posts",
        service: "x",
      },
    ]);
  });

  it("builds an OAuth authorization URL and setup state", async () => {
    const records: TwitterApiCallEvent[] = [];
    const client = createTwitterClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(),
      ) as typeof fetch,
      now: () => 1000,
      recordApiCall: (event) => records.push(event),
    });

    const request = await client.createAuthorizationRequest("https://example.com/auth/callback");
    const url = new URL(request.url);

    expect(url.origin + url.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.com/auth/callback");
    expect(url.searchParams.get("scope")).toBe("tweet.read users.read offline.access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(request.setupState.state);
    expect(request.setupState.createdAt).toBe(1000);
    expect(request.setupState.codeVerifier.length).toBeGreaterThan(20);
    expect(records).toEqual([]);
  });

  it("does not include secrets in recorded API call events", async () => {
    const records: TwitterApiCallEvent[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        access_token: "new-access",
        expires_in: 7200,
        refresh_token: "new-refresh",
        token_type: "bearer",
      }),
    );
    const client = createTwitterClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: fetchMock as typeof fetch,
      now: () => 1000,
      recordApiCall: (event) => records.push(event),
    });

    await client.refreshTokens("old-refresh");

    const serializedRecords = JSON.stringify(records);
    expect(serializedRecords).not.toContain("new-access");
    expect(serializedRecords).not.toContain("new-refresh");
    expect(serializedRecords).not.toContain("old-refresh");
    expect(serializedRecords).not.toContain("client-secret");
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
