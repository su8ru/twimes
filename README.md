# twimes

Twitter to Discord times, with Cloudflare Workers.

```text
Twitter user timeline
  -> Cloudflare Worker
  -> Durable Object alarm
  -> Discord channel
```

## Setup

### `wrangler.jsonc`

```jsonc
{
  "vars": {
    "DISCORD_CHANNEL_ID": "...",
    "TWITTER_USER_ID": "...",
    "TWITTER_USERNAME": "...",
  },
}
```

### Workers secrets

```bash
pnpm wrangler secret put DISCORD_BOT_TOKEN
pnpm wrangler secret put TWITTER_CLIENT_ID
pnpm wrangler secret put TWITTER_CLIENT_SECRET
pnpm wrangler secret put SETUP_TOKEN
```

### Discord permissions

```text
Send Messages
Embed Links
```

## OAuth

### Local

```bash
pnpm dev
open "http://localhost:8787/auth/start?token=<SETUP_TOKEN>"
```

### Production

```text
https://<worker-url>/auth/start?token=<SETUP_TOKEN>
```

## Development

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

## Operations

### Alarm watchdog

```bash
curl "http://localhost:8787/alarm"
```

### Workers Logs query

```text
event = "x_api_call"
operation = "list_user_posts"
operation = "refresh_tokens"
operation = "exchange_authorization_code"
ok = false
```

## Notes

```text
Polling interval: 30s
Cron trigger: alarm watchdog
First poll: save latest post ID, no forwarding
Later polls: forward newer posts, oldest first
Discord message: fixupx.com URL only
Token refresh: before access token expiry
```

## License

MIT
