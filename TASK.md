# OpenTrade — Roadmap & Tasks

## Current State (Phase 0)

Telegram LLM-chatbot + PostgreSQL. No trading functionality.

**Stack:**
- **Runtime:** Node.js 24 + TypeScript 5.x
- **Package manager:** pnpm
- **Telegram:** grammY
- **LLM:** Vercel AI SDK (Claude, GPT, DeepSeek, Gemini, Ollama)
- **Database:** PostgreSQL + Prisma
- **Validation:** Zod
- **Exchanges:** ccxt
- **DeFi:** viem
- **Encryption:** Node.js crypto (AES-256)
- **Deploy:** Railway
- **Tests:** Vitest

**Planned files:**
- `src/messengers/telegram.ts` — Telegram bot (grammY)
- `src/config.ts` — env vars, model list, prompts
- `src/storage/postgres.ts` — PostgreSQL storage (Prisma)
- `package.json` — dependencies
- `Procfile` — Railway deployment

---

## Phase 1 — Architecture & Intent Parser

### 1.1 Project Restructuring

Refactor monolith into modular architecture:

```
src/
├── core/
│   ├── chat.ts               # LLM chat via Vercel AI SDK
│   ├── intent_parser.ts      # LLM -> structured intent (JSON) [Phase 1.2]
│   ├── engine.ts             # trade orchestrator [Phase 1.2]
│   └── confirmation.ts       # confirmation state machine [Phase 1.2]
├── messengers/
│   ├── base.ts               # MessengerAdapter ABC
│   └── telegram.ts           # grammY adapter
├── providers/
│   ├── base.ts               # Provider ABC + Order, Balance, Position types
│   └── mock.ts               # mock provider for testing
├── storage/
│   └── postgres.ts           # Prisma storage
├── config.ts
└── main.ts
```

- [x] Create package structure (`src/`)
- [x] Extract Telegram-specific code into `messengers/telegram.ts`
- [x] Define `MessengerAdapter` ABC in `messengers/base.ts`
- [x] Move storage to `storage/postgres.ts`
- [x] Create `main.ts` entry point
- [x] Verify bot still works after refactor (`pnpm install && pnpm db:migrate && pnpm dev`)

### 1.2 Intent Parser

Two-stage pipeline: classification -> extraction.

- [x] Define intent schema (Zod: type, action, asset, quoteCurrency, amount, amountType, condition, confidence)
- [x] Stage 1 — classify message: trade intent vs regular chat (confidence threshold)
- [x] Stage 2 — extract structured parameters (`generateObject` via Vercel AI SDK)
- [x] Confidence thresholds: <0.5 = chat, 0.5-0.8 = clarify, >0.8 = proceed to confirmation
- [x] Route trade intents to engine, regular messages to LLM as before
- [x] Tests: fuzzing parser with ambiguous messages to prevent accidental trades

### 1.3 Confirmation Flow

State machine for trade confirmations.

- [x] Define states: `CREATED -> SHOWN -> CONFIRMED -> EXECUTING -> DONE | CANCELLED | EXPIRED | FAILED`
- [x] DB table `pending_confirmations` (user_id, intent, state, created_at, expires_at)
- [x] Confirmation card: asset, amount + [Confirm] [Cancel] inline buttons (grammY)
- [x] Timeout: auto-cancel after 60s (setInterval every 10s, edits message to "⏰ Expired")
- [x] Confirmation levels:
  - Normal (<$500): single button ✅
  - Large (>$500): type exact amount to confirm
  - Critical (>$5000 or "sell all"): type amount + second ✅ button
- [x] Prevent double-click execution (atomic state check: only SHOWN → CONFIRMED)
- [x] Persist pending confirmations across bot restarts (DB-backed, recovered on start)

---

## Phase 2 — First Exchange (Trading MVP)

### 2.1 Provider Interface

- [x] Define `Provider` ABC in `providers/base.ts`:
  - `connect(credentials) -> bool`
  - `get_balance() -> list[Balance]`
  - `get_price(symbol) -> Decimal`
  - `market_order(symbol, side, amount) -> Order`
  - `limit_order(symbol, side, amount, price) -> Order`
  - `cancel_order(order_id) -> bool`
  - `get_orders() -> list[Order]`
- [x] Define shared types: `Order`, `Balance`, `Position`
- [x] Auto-discovery: scan `providers/` for Provider subclasses

### 2.2 OKX Provider (via ccxt)

Provider structure:
```
src/providers/
├── exchanges/
│   ├── okx/
│   │   ├── provider.ts    # implements BaseProvider
│   │   └── SKILL.md       # LLM instructions for this exchange
│   ├── binance/
│   └── bybit/
├── brokers/
│   ├── alpaca/
│   └── tinkoff/
└── defi/
    ├── uniswap/
    └── jupiter/
```

- [x] Implement `providers/exchanges/okx/provider.ts` + `SKILL.md`
- [x] Market orders, limit orders
- [x] Balance retrieval, portfolio
- [x] Price fetching
- [x] Add `ccxt` to dependencies

### 2.3 Key Management

- [x] AES-256 encryption for API keys with user master password
- [x] DB table `user_credentials` (user_id, provider, encrypted_key, encrypted_secret)
- [x] Keys decrypted only at execution time, never sent to LLM
- [x] CLI: `opentrade connect okx` → prompts for key + secret in terminal → encrypts → stores in DB
- [x] CLI: `opentrade disconnect okx` → removes credentials from DB
- [x] CLI: `opentrade connections` → lists connected exchanges
- [x] CLI: `opentrade test okx` → verifies connection
- [x] Keys never pass through Telegram — setup is terminal-only

### 2.4 Core Trading Commands

- [x] `"show portfolio"` -> aggregated balance with prices
- [x] `"buy BTC for $500"` -> confirmation card -> market order
- [x] `"sell half my ETH"` -> calculate 50% -> confirmation -> execute
- [x] `"limit order SOL at $150"` -> limit order
- [x] `"my open orders"` -> list
- [x] `"cancel order #123"` -> cancel

---

## Phase 3 — Security & Risk Management

### 3.1 Risk Controls

- [x] Max order size (configurable, default $1000)
- [x] Rate limiting (max N orders per minute)
- [x] Margin trading disabled by default
- [x] Cooldown after large orders

### 3.2 Audit Log

- [x] DB table `audit_log` (user_id, action, intent, result, timestamp)
- [x] Full chain: intent -> confirmation -> execution -> result
- [x] `"show my trade history"` command

### 3.3 Testing

- [x] Paper trading mode (simulated execution)
- [x] Integration tests with OKX testnet
- [x] Intent parser fuzz tests

---

## Phase 4 — Multi-Exchange

- [x] Binance provider
- [x] Bybit provider
- [x] OKX provider
- [x] Cross-exchange portfolio view
- [x] Per-exchange `/connect` flow — CLI-only (`pnpm cli connect <exchange>`), keys never pass through Telegram

---

## Phase 5 — DeFi

- [ ] Uniswap provider (viem)
- [ ] Wallet connection (private key or WalletConnect)
- [ ] `"swap ETH to USDC"` via DEX aggregator (1inch)
- [ ] Gas estimation in confirmation card
- [ ] Token approval flow

---

## Phase 6 — Multi-Messenger

- [ ] `MessengerAdapter` ABC (send_message, send_confirmation_card, on_message, on_button)
- [ ] Discord adapter
- [ ] WhatsApp adapter (Business API / Twilio)
- [ ] Web UI (fallback chat interface)

---

## Phase 7 — Stocks & Traditional Finance

- [ ] Alpaca provider (free API)
- [ ] Interactive Brokers provider
- [ ] Unified portfolio: crypto + stocks + DeFi
- [ ] Dividends / splits notifications

---

## Phase 8 — Advanced Strategies

- [ ] DCA: `"buy BTC $100 every Monday"`
- [ ] Price alerts: `"notify when ETH < 2000"`
- [ ] TP/SL: `"buy SOL, take profit at +20%"`
- [ ] Portfolio analytics: PnL, allocation, historical returns

---

## Architecture Invariants (non-negotiable)

1. **Intent Parser is fail-safe** — confidence < 0.8 = clarify, < 0.5 = treat as chat. Never execute on ambiguity.
2. **Keys are local and encrypted** — AES-256, decrypted only at execution time, never in LLM context.
3. **Confirmation for every financial operation** — no auto-execution, ever. State machine with timeout.
4. **Strict layer separation:**
   ```
   [Messenger] -> text -> [Intent Parser] -> JSON -> [Confirmation] -> confirmed -> [Engine] -> [Provider]
   ```
   Each layer knows nothing about adjacent layers' internals.
5. **One folder per provider** — `src/providers/{exchanges,brokers,defi}/<name>/` with `provider.ts` + `SKILL.md`. Community contributes via PR to the main repository.

---

## Dependency Graph

```
Phase 1 (architecture + intent parser)
   |
Phase 2 (first exchange = MVP)        <-- key milestone
   |                |
Phase 3 (security)  Phase 4 (multi-exchange)
   |                |
Phase 5 (DeFi)     Phase 6 (multi-messenger)
        |       |
     Phase 7 (stocks)
           |
     Phase 8 (strategies)
```

Phase 1 + 2 = usable product. Everything after = expansion.
