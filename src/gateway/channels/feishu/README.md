# Feishu Bot Channel for Dexter

## Overview

This module provides Feishu (Lark) Bot integration for Dexter using **WebSocket long connection** - no public URL or firewall configuration needed!

## Recommended: WebSocket Mode (ws-server.ts)

The `ws-server.ts` uses Feishu's WebSocket SDK to maintain a persistent outbound connection. **No public IP or port forwarding required!**

### Step 1: Create a Feishu Bot

1. Go to [Feishu Open Platform](https://open.feishu.cn/)
2. Create a new app (or use an existing one)
3. Get your **App ID** and **App Secret** from `Credentials` tab
4. Enable **Bot** capability in `App Capabilities`

### Step 2: Configure Event Subscription (Critical!)

1. Go to `Events & Callbacks` in your app
2. Choose **Use long connection to receive events** (WebSocket)
3. Add event: `im.message.receive_v1`

⚠️ **If you see "long connection" not available**, your app may not be a "self-built" app. You may need to create a new self-built app.

### Step 3: Set Permissions

Go to `Permissions & Scopes` → `Batch import` and paste:
```json
{
  "scopes": {
    "tenant": [
      "im:message",
      "im:message.p2p_msg:readonly",
      "im:message:send_as_bot",
      "im:chat.members:bot_access",
      "im:chat.access_event.bot_p2p_chat:read"
    ]
  }
}
```

### Step 4: Run the Server

```bash
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=xxx
export DEXTER_AGENT_URL=http://localhost:3000

bun run src/gateway/channels/feishu/ws-server.ts
```

### Step 5: Test

Send a message to your bot in Feishu!

---

## Legacy: Webhook Mode (server.ts)

If WebSocket mode doesn't work, use the HTTP webhook approach (requires public URL):

```bash
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=xxx
export FEISHU_PORT=8088
export DEXTER_AGENT_URL=http://localhost:3000

bun run src/gateway/channels/feishu/server.ts
```

Then configure the webhook URL in `Event Subscriptions` → `Use webhook to receive events`.

## Architecture

```
┌──────────────┐     ┌─────────────────────┐     ┌────────────────┐
│  Feishu App  │◀───▶│  WS Server (us)    │────▶│  Dexter Agent  │
│              │     │  connects OUT to    │◀────│  (AI Brain)    │
└──────────────┘     │  Feishu servers    │     └────────────────┘
                     └─────────────────────┘
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FEISHU_APP_ID` | Yes | - | Bot App ID |
| `FEISHU_APP_SECRET` | Yes | - | Bot App Secret |
| `FEISHU_DOMAIN` | No | feishu | "feishu" or "lark" (international) |
| `DEXTER_AGENT_URL` | No | http://localhost:3000 | Dexter agent endpoint |

## Troubleshooting

### "Long connection not available"
- Only **self-built apps** (自建应用) support WebSocket long connection
- Enterprise apps from the marketplace may not support this mode
- Solution: Create a new self-built app at https://open.feishu.cn/

### Bot doesn't respond
1. Check if WebSocket connected: `[info]: [ "[ws]", "ws client ready" ]
2. Verify event subscription: `im.message.receive_v1` is subscribed
3. Ensure app is published and approved
