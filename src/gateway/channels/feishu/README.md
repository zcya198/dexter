# Feishu Bot Channel for Dexter

## Overview

This module provides Feishu (Lark) Bot integration for Dexter. It consists of:

1. **Webhook Server** (`server.ts`) - Standalone HTTP server that receives Feishu events and forwards them to Dexter
2. **Channel Plugin** (`plugin.ts`) - Can be integrated into the Dexter gateway for full-featured support

## Quick Start

### Step 1: Create a Feishu Bot

1. Go to [Feishu Open Platform](https://open.feishu.cn/)
2. Create a new app (or use an existing one)
3. Get your **App ID** and **App Secret** from `Credentials` tab
4. Enable **Bot** capability in `App Capabilities`

### Step 2: Configure Webhook

1. Go to `Event Subscriptions` tab
2. Set **Request URL** to `http://your-server:8088/webhook`
3. Subscribe to event: `im.message.receive_v1`

### Step 3: Run the Server

```bash
# Set environment variables
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=xxx
export FEISHU_PORT=8088

# Run
bun run src/gateway/channels/feishu/server.ts
```

### Step 4: Message the Bot

Find your bot in Feishu and send it a message. It will forward to Dexter!

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FEISHU_APP_ID` | Yes | - | Bot App ID from Feishu Open Platform |
| `FEISHU_APP_SECRET` | Yes | - | Bot App Secret |
| `FEISHU_VERIFICATION_TOKEN` | No | - | Webhook verification token |
| `FEISHU_PORT` | No | 8088 | HTTP server port |
| `FEISHU_HOST` | No | 0.0.0.0 | HTTP server host |
| `DEXTER_AGENT_URL` | No | http://localhost:3000 | Dexter agent endpoint |

## Architecture

```
┌──────────────┐     ┌─────────────────────┐     ┌────────────────┐
│  Feishu App  │────▶│  Feishu Bot Server  │────▶│  Dexter Agent  │
│              │◀────│  (Webhook Receiver) │◀────│  (AI Brain)    │
└──────────────┘     └─────────────────────┘     └────────────────┘
```

## Features

- ✅ Direct message handling
- ✅ Rate limiting (10 messages/minute per user)
- ✅ Text message parsing
- ✅ Typing indicator
- ✅ Session management
- ⏳ Group message support (coming soon)
- ⏳ Rich content / cards (coming soon)

## Feishu App Setup Checklist

- [ ] Create app at https://open.feishu.cn/app
- [ ] Enable Bot capability
- [ ] Get App ID and App Secret
- [ ] Configure webhook URL in Event Subscriptions
- [ ] Subscribe to `im.message.receive_v1`
- [ ] Set permissions (optional but recommended):
  - `im:message:receive_v1`
  - `im:message`
  - `contact:user.id:readonly`
- [ ] Publish the app (for enterprise apps, you may need admin approval)
