import { DurableObject } from "cloudflare:workers";

import type { Env } from "../env";
import { createDiscordForwarder } from "../services/discord";
import { createTwitterClient, type TwitterApiCallEvent } from "../services/twitter";
import { createDurableObjectTwimesStateStore, type TwimesStateStore } from "../state/twimes-state";
import { completeOAuthSetup, OAuthSetupError, startOAuthSetup } from "../usecases/oauth-setup";
import { pollAndForward, type PollAndForwardResult } from "../usecases/poll-and-forward";

const TOKEN_REFRESH_BEFORE_MS = 60 * 1000;

export class TwimesCoordinator extends DurableObject<Env> {
  private runningPoll: Promise<PollAndForwardResult> | undefined;

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/scheduled") {
      this.runningPoll ??= this.handleScheduled().finally(() => {
        this.runningPoll = undefined;
      });
      return Response.json(await this.runningPoll);
    }

    if (request.method === "GET" && url.pathname === "/auth/start") {
      return await this.handleAuthStart(url);
    }

    if (request.method === "GET" && url.pathname === "/auth/callback") {
      return await this.handleAuthCallback(url);
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleScheduled(): Promise<PollAndForwardResult> {
    return await pollAndForward({
      config: {
        now: Date.now,
        refreshBeforeMs: TOKEN_REFRESH_BEFORE_MS,
        twitterUserId: this.env.TWITTER_USER_ID,
        twitterUsername: this.env.TWITTER_USERNAME,
      },
      discord: createDiscordForwarder({
        botToken: this.env.DISCORD_BOT_TOKEN,
        channelId: this.env.DISCORD_CHANNEL_ID,
      }),
      state: this.createStore(),
      twitter: this.createTwitter(),
    });
  }

  private async handleAuthStart(url: URL): Promise<Response> {
    return await this.toOAuthResponse(async () => {
      const result = await startOAuthSetup({
        expectedSetupToken: this.env.SETUP_TOKEN,
        providedSetupToken: url.searchParams.get("token"),
        redirectUri: this.getRedirectUri(url),
        state: this.createStore(),
        twitter: this.createTwitter(),
      });

      return Response.redirect(result.redirectUrl, 302);
    });
  }

  private async handleAuthCallback(url: URL): Promise<Response> {
    return await this.toOAuthResponse(async () => {
      await completeOAuthSetup({
        code: url.searchParams.get("code"),
        now: Date.now,
        receivedState: url.searchParams.get("state"),
        redirectUri: this.getRedirectUri(url),
        state: this.createStore(),
        twitter: this.createTwitter(),
      });

      return new Response("Twitter OAuth setup completed.");
    });
  }

  private createStore(): TwimesStateStore {
    return createDurableObjectTwimesStateStore(this.ctx.storage);
  }

  private createTwitter() {
    return createTwitterClient({
      clientId: this.env.TWITTER_CLIENT_ID,
      clientSecret: this.env.TWITTER_CLIENT_SECRET,
      recordApiCall: recordTwitterApiCall,
    });
  }

  private getRedirectUri(url: URL): string {
    return new URL("/auth/callback", url.origin).toString();
  }

  private async toOAuthResponse(handler: () => Promise<Response>): Promise<Response> {
    try {
      return await handler();
    } catch (error) {
      if (error instanceof OAuthSetupError) {
        return new Response(error.message, { status: error.status });
      }

      throw error;
    }
  }
}

const recordTwitterApiCall = (event: TwitterApiCallEvent): void => {
  console.log(JSON.stringify(event));
};
