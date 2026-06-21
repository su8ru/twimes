import type { TwimesCoordinator } from "./durable-objects/twimes-coordinator";

export type Env = {
  DISCORD_BOT_TOKEN: string;
  DISCORD_CHANNEL_ID: string;
  SETUP_TOKEN: string;
  TWIMES_COORDINATOR: DurableObjectNamespace<TwimesCoordinator>;
  TWITTER_CLIENT_ID: string;
  TWITTER_CLIENT_SECRET: string;
  TWITTER_USER_ID: string;
  TWITTER_USERNAME: string;
};
