# Fast Bingo

Fast Bingo is a Telegram-style 75-ball bingo demo with quick rooms, host-controlled rounds, 400 cards, demo balances, and English/Amharic support.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite at the root preview
- Game state: SQLite via Node 24's built-in `node:sqlite` runtime

## Where things live

- `artifacts/fast-bingo/src/App.tsx` — responsive game console, play room, wallet and admin routes
- `artifacts/fast-bingo/src/index.css` — Fast Bingo visual theme and responsive layout rules
- `artifacts/api-server/src/lib/bingo-store.ts` — SQLite schema, card seed, game engine and demo wallet store
- `artifacts/api-server/src/routes/bingo.ts` — bingo API routes
- `lib/api-spec/openapi.yaml` — source of truth for bingo API contracts

## Architecture decisions

- The first release is intentionally demo-only: payment methods are presentation options and wallet operations only change local demo credit.
- The game store uses SQLite directly in the API server to keep the demo portable and easy to run while matching the requested persistence model.
- The API is contract-first through OpenAPI and generated clients; the frontend does not hardcode game payload shapes.

## Product

- 75-ball classic bingo with 5×5 cards and automatic winner checking.
- Quick room creation, share codes, live called-number history, and host actions.
- Normal, VIP and VVIP categories, 400 seeded cards, a demo wallet, and admin metrics.
- English and Amharic UI toggle with mobile-friendly Telegram-style navigation.

## User preferences

- Keep this a play-money demonstration. Do not add real-money gambling or payment processing without an explicit new request.

## Gotchas

- Node 24 emits an experimental warning for `node:sqlite`; this is expected for the demo runtime.
- Re-run `pnpm --filter @workspace/api-spec run codegen` after changing the OpenAPI contract.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
