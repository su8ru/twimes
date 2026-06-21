import { REST } from "@discordjs/rest";
import {
  MessageFlags,
  Routes,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";

import type { DiscordForwarder } from "../usecases/poll-and-forward";

export type DiscordForwarderConfig = {
  botToken: string;
  channelId: string;
};

export type DiscordRestClient = {
  post: (
    route: `/${string}`,
    options: { body: RESTPostAPIChannelMessageJSONBody },
  ) => Promise<unknown>;
};

export const createDiscordForwarder = (
  config: DiscordForwarderConfig,
  rest: DiscordRestClient = new REST({ version: "10" }).setToken(config.botToken),
): DiscordForwarder => {
  return {
    sendTweetUrl: async (url) => {
      await rest.post(Routes.channelMessages(config.channelId), {
        body: {
          allowed_mentions: {
            parse: [],
          },
          content: url,
          flags: MessageFlags.SuppressNotifications,
        },
      });
    },
  };
};
