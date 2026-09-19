---
name: Telegram polling deployment
description: Runtime and deployment constraint for the Fast Bingo Telegram integration.
---

Fast Bingo uses Telegram long polling from the API server rather than a public webhook. The bot token stays server-side.

**Why:** Polling works in the current TypeScript server without adding a webhook endpoint or exposing credentials to the frontend, while still supporting automatic calls and callback buttons.

**How to apply:** Keep a single API process running and use a Reserved VM deployment for continuous bot availability. Development workflow testing works only while the API workflow is running.