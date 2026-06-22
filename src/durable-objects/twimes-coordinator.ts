import { DurableObject } from "cloudflare:workers";

import type { Env } from "../env";
import { createDiscordForwarder } from "../services/discord";
import { createTwitterClient, type TwitterApiCallEvent } from "../services/twitter";
import { createDurableObjectTwimesStateStore, type TwimesStateStore } from "../state/twimes-state";
import { completeOAuthSetup, OAuthSetupError, startOAuthSetup } from "../usecases/oauth-setup";
import { pollAndForward, type PollAndForwardResult } from "../usecases/poll-and-forward";

import {
  ensurePollingAlarm,
  scheduleNextPollingAlarm,
  type AlarmWatchdogResult,
} from "./alarm-scheduler";

const TOKEN_REFRESH_BEFORE_MS = 60 * 1000;

export class TwimesCoordinator extends DurableObject<Env> {
  private runningPoll: Promise<PollAndForwardResult> | undefined;

  override async alarm(): Promise<void> {
    await scheduleNextPollingAlarm({
      now: Date.now,
      storage: this.ctx.storage,
    });

    try {
      await this.runPoll();
    } catch (error) {
      recordAlarmEvent({
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
        ok: false,
      });
    } finally {
      await scheduleNextPollingAlarm({
        now: Date.now,
        storage: this.ctx.storage,
      });
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/scheduled") {
      return Response.json(await this.ensurePollingAlarm());
    }

    if (request.method === "GET" && url.pathname === "/alarm") {
      return Response.json(await this.ensurePollingAlarm());
    }

    if (request.method === "GET" && url.pathname === "/auth/start") {
      return await this.handleAuthStart(url);
    }

    if (request.method === "GET" && url.pathname === "/auth/callback") {
      return await this.handleAuthCallback(url);
    }

    return new Response("Not found", { status: 404 });
  }

  private async handlePoll(): Promise<PollAndForwardResult> {
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

      await this.ensurePollingAlarm();

      return new Response("Twitter OAuth setup completed.");
    });
  }

  private async ensurePollingAlarm(): Promise<AlarmWatchdogResult> {
    return await ensurePollingAlarm({
      isPolling: this.runningPoll !== undefined,
      now: Date.now,
      storage: this.ctx.storage,
    });
  }

  private async runPoll(): Promise<PollAndForwardResult> {
    if (this.runningPoll !== undefined) {
      return await this.runningPoll;
    }

    const poll = this.handlePoll();
    this.runningPoll = poll;

    try {
      return await poll;
    } finally {
      this.runningPoll = undefined;
    }
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

const recordAlarmEvent = (event: {
  errorMessage?: string;
  errorName?: string;
  ok: boolean;
}): void => {
  console.log(
    JSON.stringify({
      event: "alarm_poll",
      message: event.ok ? "Alarm polling completed" : "Alarm polling failed",
      service: "twimes",
      ...event,
    }),
  );
};
