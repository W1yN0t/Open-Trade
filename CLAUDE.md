# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Run with tsx (development, no compile step)
pnpm build        # Compile TypeScript → dist/
pnpm start        # Run compiled JS (production)
pnpm test         # Run Vitest suite
pnpm db:generate  # Regenerate Prisma client after schema changes
pnpm db:migrate   # Run Prisma migrations (interactive)
```

Run a single test file:
```bash
pnpm vitest run src/core/intent_parser.test.ts
```

## Environment

Copy `.env.example` to `.env` and fill in:
- `TELEGRAM_BOT_TOKEN` — from BotFather
- `DATABASE_URL` — PostgreSQL connection string
- `LLM_API_KEY` — OpenRouter (default) or any OpenAI-compatible provider
- `LLM_MODEL` — defaults to `anthropic/claude-3-5-sonnet`
- `LLM_BASE_URL` — defaults to `https://openrouter.ai/api/v1`

## Architecture

The system has strict layer separation. Data flows in one direction:

```
Messenger (Telegram) → Intent Parser → Confirmation State Machine → Engine → Provider
                                ↕
                            Storage (Postgres/Prisma)
```

**`src/main.ts`** — Entry point. Wires all layers together, registers handlers, runs the 10s expiry loop.

**`src/core/intent_parser.ts`** — Uses Vercel AI SDK `generateObject` with a Zod schema. Classifies messages as `trade` or `chat` with a confidence score. Confidence < 0.5 → chat response; 0.5–0.8 → ask for clarification; ≥ 0.8 → trigger confirmation flow. This threshold is a safety invariant — never lower it without explicit user decision.

**`src/core/confirmation.ts`** — State machine with 60-second timeout. Three confirmation tiers:
- Normal (< $500): single ✅
- Large ($500–$5000): ✅ then re-type exact amount
- Critical (> $5000 or "sell all"): amount re-type then second ✅

States: `CREATED → SHOWN → CONFIRMED → DONE / CANCELLED / EXPIRED / FAILED`

**`src/core/engine.ts`** — Trade orchestrator (Phase 1.2 placeholder — not yet implemented).

**`src/core/chat.ts`** — Wraps Vercel AI SDK for history-aware LLM responses.

**`src/messengers/`** — Abstract `MessengerAdapter` in `base.ts`; Telegram implementation via grammY in `telegram.ts`. Future messengers (Discord, WhatsApp) implement the same interface.

**`src/providers/`** — Abstract `Provider` interface in `base.ts` with `Balance`, `Order`, `Position` types. `mock.ts` is the only implementation; real exchanges (OKX via ccxt) come in Phase 2.

**`src/storage/postgres.ts`** — Prisma wrapper for three tables: `ChatMessage` (conversation history), `UserSettings` (per-user LLM model), `PendingConfirmation` (state machine persistence).

**`prisma/schema.prisma`** — Source of truth for DB schema. Always run `pnpm db:generate` after editing it.

## Architecture Invariants

These constraints are non-negotiable per the project design:

1. **Intent parser is fail-safe** — confidence < 0.8 never reaches the engine.
2. **Every trade requires explicit confirmation** — no auto-execution path exists.
3. **Keys are local and encrypted** — AES-256, decrypted only at execution time (Phase 2).
4. **Layer separation is strict** — messengers know nothing about providers; engine knows nothing about messengers.
5. **One folder per provider in `src/providers/`** — `provider.ts` + `SKILL.md`. Community contributes via PR to main repository.

## Current Status

Phase 0 is complete. Phase 1 (first real exchange integration via ccxt + key management) is next. `src/core/engine.ts` is the main placeholder to fill in.
