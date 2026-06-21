export type OAuthTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
  tokenType: string;
};

export type OAuthSetupState = {
  codeVerifier: string;
  state: string;
  createdAt: number;
};
