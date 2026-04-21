# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Run with tsx (development, no compile step)
npm run build     # Type-check TypeScript (tsc --noEmit)
npm test          # Run Vitest suite
npm run db:generate  # Regenerate Prisma client after schema changes
npm run db:migrate   # Run Prisma migrations (interactive)
```

Run a single test file:
```bash
npx vitest run src/core/risk.test.ts
```

CLI for credential and model management (terminal-only):
```bash
npm run cli connect okx       # prompt for key/secret/password → encrypt → store
npm run cli disconnect okx    # remove from DB
npm run cli connections        # list connected exchanges
npm run cli test okx           # verify connection (decrypts + calls balance)
npm run cli models             # list installed Ollama models with size/quantization
npm run cli models --lmstudio  # list models loaded in LM Studio
npm run cli model use <name>   # smoke-test model then set as active in DB
npm run cli model pull <name>  # pull a model via Ollama (streams progress)
```

## Environment

Copy `.env.example` to `.env` and fill in:
- `TELEGRAM_BOT_TOKEN` — from BotFather
- `DATABASE_URL` — PostgreSQL connection string
- `MASTER_PASSWORD` — encrypts/decrypts all stored API keys (AES-256-GCM)
- `PAPER_TRADING=true` — enables paper trading mode (no real orders, simulated $10k USDT balance)
- `RISK_MAX_ORDER_USD` — max single order size in USD (default: 1000)
- `RISK_MAX_ORDERS_PER_MINUTE` — rate limit per user (default: 5)
- `RISK_LARGE_ORDER_COOLDOWN_MS` — cooldown after orders ≥$500 (default: 60000)

LLM provider selection — set `LLM_PROVIDER` to one of:
- `openrouter` (default) — `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL`
- `openai` — `OPENAI_API_KEY`
- `anthropic` — `ANTHROPIC_API_KEY`
- `gemini` — `GEMINI_API_KEY`
- `ollama` — `OLLAMA_BASE_URL` (default `http://localhost:11434`)
- `lmstudio` — `LM_STUDIO_BASE_URL` (default `http://localhost:1234/v1`)

Local providers (ollama, lmstudio) are health-checked on startup and fall back to openrouter if unreachable. Cloud providers skip the health check.

OKX testnet integration tests activate when these are set:
- `OKX_TESTNET_KEY`, `OKX_TESTNET_SECRET`, `OKX_TESTNET_PASSWORD`

## Architecture

Strict layer separation — each layer is unaware of its neighbors' internals:

```
Telegram → Intent Parser → Confirmation State Machine → Engine → Provider
                                     ↕
                               Storage (Postgres/Prisma)
                                     ↕
                               Audit Log (every trade)
```

**`src/main.ts`** — Wires all layers. Handles the message loop, callback buttons, and a 10s expiry interval for stale confirmations. The `history` action is resolved here from DB (not forwarded to Engine).

**`src/core/intent_parser.ts`** — `generateObject` via Vercel AI SDK with a Zod schema. Confidence thresholds are a hard safety invariant: `< 0.5` → chat, `0.5–0.8` → clarification request, `≥ 0.8` → confirmation flow. Never lower these without an explicit decision.

**`src/core/confirmation.ts`** — DB-backed state machine. States: `CREATED → SHOWN → CONFIRMED → DONE / CANCELLED / EXPIRED / FAILED`. Three tiers: Normal (<$500) one ✅; Large ($500–$5000) ✅ + retype amount; Critical (>$5000 or "sell all") retype + second ✅.

**`src/core/engine.ts`** — Resolves which provider a user has connected, runs risk checks, then dispatches to the appropriate provider method. Provider instances are cached by `${userId}:${providerName}`. `portfolio`/`balance` aggregates across all connected exchanges for a user. In paper mode (`PAPER_TRADING=true`) it bypasses credentials entirely and uses a singleton `PaperProvider`. All trade responses are prefixed `[PAPER]` in that mode.

**`src/core/risk.ts`** — `RiskManager` enforces four controls before any trade executes: max order size, rate limiting (orders/min), large-order cooldown, and margin/futures block. All thresholds are configurable via env.

**`src/core/credentials.ts`** — AES-256-GCM encryption with per-user scrypt-derived keys. Credentials are decrypted only at execution time and never stored in memory beyond the request.

**`src/llm/provider.ts`** — `getModel(modelName)` factory. Reads `LLM_PROVIDER` at call time and returns the appropriate Vercel AI SDK `LanguageModel`. Cloud providers (openai, anthropic, gemini) use their native SDK clients; local providers (ollama, lmstudio) use `createOpenAI` in compatibility mode pointing at their local HTTP endpoints.

**`src/llm/health.ts`** — Pings local provider on startup; falls back to openrouter by mutating `process.env.LLM_PROVIDER` if unreachable.

**`src/llm/smoke_test.ts`** — Runs two intent-parser test cases ("buy BTC for $100" → trade, "hello" → chat) against a candidate model before `model use` activates it.

**`src/providers/`** — Abstract `Provider` in `base.ts`. Auto-discovery in `registry.ts` walks the directory tree and imports any file named `provider.ts`, registering classes that extend `Provider` by their `name` property. Current implementations: `mock`, `paper`, `okx`, `binance`, `bybit`.

**`src/storage/postgres.ts`** — Prisma wrapper. Tables: `ChatMessage`, `UserSettings`, `PendingConfirmation`, `AuditLog`, `UserCredentials`.

**`prisma/schema.prisma`** — Source of truth for DB schema. Always run `npm run db:generate` after editing, then `npm run db:migrate` to apply.

## Architecture Invariants

1. **Intent parser is fail-safe** — confidence < 0.8 never reaches the engine.
2. **Every trade requires explicit confirmation** — no auto-execution path exists.
3. **Keys are local and encrypted** — AES-256-GCM, decrypted only at execution time, never passed to LLM or Telegram.
4. **Layer separation is strict** — messengers know nothing about providers; engine knows nothing about messengers.
5. **One folder per provider** — `src/providers/{exchanges,brokers,defi}/<name>/provider.ts` + `SKILL.md`. Providers are auto-discovered at startup.
6. **Audit log is written for every terminal trade state** — success, failed, cancelled, and expired confirmations all produce an `AuditLog` record.

## Adding a New Provider

1. Create `src/providers/exchanges/<name>/provider.ts` extending `Provider` from `../../base.ts`
2. Implement all abstract methods: `connect`, `getBalance`, `getPrice`, `marketOrder`, `limitOrder`, `cancelOrder`, `getOrders`
3. Set `name` property to a lowercase identifier (used as the registry key and CLI argument)
4. Create `src/providers/exchanges/<name>/SKILL.md` with exchange-specific LLM instructions
5. The provider is auto-discovered — no registration step needed
