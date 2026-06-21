# twimes

Twitter の user posts timeline を 1 分ごとに polling し、新規投稿を Discord チャンネルへ転送する Cloudflare Workers アプリです。

## Stack

- Cloudflare Workers
- Durable Objects
- Hono
- TypeScript
- Vitest
- pnpm

## Configuration

`wrangler.jsonc` の `vars`:

- `DISCORD_CHANNEL_ID`
- `TWITTER_USER_ID`
- `TWITTER_USERNAME`

Secrets:

```bash
pnpm wrangler secret put DISCORD_BOT_TOKEN
pnpm wrangler secret put TWITTER_CLIENT_ID
pnpm wrangler secret put TWITTER_CLIENT_SECRET
pnpm wrangler secret put SETUP_TOKEN
```

Twitter OAuth scopes:

```text
tweet.read users.read offline.access
```

Discord Bot には対象チャンネルで `Send Messages` と `Embed Links` 権限が必要です。

## Setup OAuth

```bash
pnpm dev
open "http://localhost:8787/auth/start?token=<SETUP_TOKEN>"
```

本番では deploy 後の Worker URL で同じ endpoint を開きます。

## Local Verification

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm dev
curl "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
```

OAuth token が未設定の場合、scheduled route は `Twitter OAuth tokens are not configured` で失敗します。

## Observability

Workers Logs / Query Builder で `event = "x_api_call"` を検索すると、X API 呼び出しを確認できます。

主な絞り込み:

- `operation = "list_user_posts"`: polling の user posts timeline 取得
- `operation = "refresh_tokens"`: OAuth token refresh
- `operation = "exchange_authorization_code"`: 初回 OAuth callback の token exchange
- `ok = false`: 失敗した X API 呼び出し

ログには status、durationMs、endpoint を出します。access token、refresh token、client secret、OAuth code は出しません。
