import { MessageFlags, Routes } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";

import { createDiscordForwarder } from "../../src/services/discord";

describe("createDiscordForwarder", () => {
  it("sends only the tweet URL as a silent message without mentions", async () => {
    const rest = {
      post: vi.fn(async () => ({})),
    };
    const client = createDiscordForwarder(
      {
        botToken: "bot-token",
        channelId: "channel-id",
      },
      rest,
    );

    await client.sendTweetUrl("https://fixupx.com/su8ru/status/12");

    expect(rest.post).toHaveBeenCalledWith(Routes.channelMessages("channel-id"), {
      body: {
        allowed_mentions: {
          parse: [],
        },
        content: "https://fixupx.com/su8ru/status/12",
        flags: MessageFlags.SuppressNotifications,
      },
    });
  });
});
