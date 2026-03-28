/**
 * Feishu/Lark Bot Channel for Dexter
 *
 * Usage:
 * 1. Create a Feishu Bot in the Feishu Open Platform (https://open.feishu.cn/)
 * 2. Get App ID and App Secret from your app's credentials page
 * 3. Configure in gateway.json:
 *    {
 *      "channels": {
 *        "feishu": {
 *          "enabled": true,
 *          "port": 8088,
 *          "accounts": {
 *            "default": {
 *              "appId": "cli_xxx",
 *              "appSecret": "xxx",
 *              "allowFrom": []
 *            }
 *          }
 *        }
 *      }
 *    }
 * 4. Set webhook URL in Feishu app console: http://your-server:8088/webhook
 * 5. Subscribe to events: im.message.receive_v1
 */

export * from './types.js';
export * from './api.js';
export * from './inbound.js';
export * from './outbound.js';
export * from './plugin.js';
