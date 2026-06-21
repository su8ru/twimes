import type { OAuthSetupState, OAuthTokenSet } from "../domain/oauth";
import type { TwimesStateStore } from "../state/twimes-state";

export const OAUTH_SETUP_TTL_MS = 10 * 60 * 1000;

export class OAuthSetupError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type OAuthAuthorizationClient = {
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

export const startOAuthSetup = async (input: {
  expectedSetupToken: string;
  providedSetupToken: string | null;
  redirectUri: string;
  state: TwimesStateStore;
  twitter: Pick<OAuthAuthorizationClient, "createAuthorizationRequest">;
}): Promise<{ redirectUrl: string }> => {
  if (input.providedSetupToken !== input.expectedSetupToken) {
    throw new OAuthSetupError("Unauthorized", 401);
  }

  const authorizationRequest = await input.twitter.createAuthorizationRequest(input.redirectUri);
  await input.state.setOAuthSetupState(authorizationRequest.setupState);

  return { redirectUrl: authorizationRequest.url };
};

export const completeOAuthSetup = async (input: {
  code: string | null;
  now: () => number;
  receivedState: string | null;
  redirectUri: string;
  state: TwimesStateStore;
  twitter: Pick<OAuthAuthorizationClient, "exchangeAuthorizationCode">;
}): Promise<void> => {
  if (input.code === null || input.receivedState === null) {
    throw new OAuthSetupError("Missing OAuth callback parameters", 400);
  }

  const setupState = await input.state.getOAuthSetupState();
  if (setupState === undefined) {
    throw new OAuthSetupError(
      "OAuth setup state was not found. Start again from /auth/start.",
      400,
    );
  }

  if (setupState.state !== input.receivedState) {
    throw new OAuthSetupError("OAuth state mismatch", 400);
  }

  if (setupState.createdAt + OAUTH_SETUP_TTL_MS < input.now()) {
    await input.state.clearOAuthSetupState();
    throw new OAuthSetupError("OAuth setup state expired. Start again from /auth/start.", 400);
  }

  const tokens = await input.twitter.exchangeAuthorizationCode({
    code: input.code,
    codeVerifier: setupState.codeVerifier,
    redirectUri: input.redirectUri,
  });

  await input.state.setOAuthTokens(tokens);
  await input.state.clearOAuthSetupState();
};
