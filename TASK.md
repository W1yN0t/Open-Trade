# OpenTrade — Roadmap & Tasks

## Current State (Phase 0)

Telegram LLM-chatbot via OpenRouter + PostgreSQL. No trading functionality.

**Existing files:**
- `bot.py` — Telegram bot (message handling, model selection, history management)
- `config.py` — env vars, model list, prompts
- `storage_postgres.py` — PostgreSQL storage (history, settings, summarization)
- `requirements.txt` — dependencies
- `Procfile` — Railway deployment

---

## Phase 1 — Architecture & Intent Parser

### 1.1 Project Restructuring

Refactor monolith into modular architecture:

```
opentrade/
├── core/
│   ├── intent_parser.py      # LLM -> structured intent (JSON)
│   ├── engine.py             # trade orchestrator
│   └── confirmation.py       # confirmation state machine
├── messengers/
│   ├── base.py               # abstract messenger adapter
│   └── telegram.py           # current bot, extracted as adapter
├── providers/
│   ├── base.py               # provider interface + shared types (Order, Balance, Position)
│   └── mock.py               # mock provider for testing
├── storage/
│   └── postgres.py           # current storage_postgres.py
├── config.py
└── main.py
```

- [ ] Create package structure (`opentrade/`)
- [ ] Extract Telegram-specific code into `messengers/telegram.py`
- [ ] Define `MessengerAdapter` ABC in `messengers/base.py`
- [ ] Move storage to `storage/postgres.py`
- [ ] Create `main.py` entry point
- [ ] Verify bot still works after refactor

### 1.2 Intent Parser

Two-stage pipeline: classification -> extraction.

- [ ] Define intent schema:
  ```json
  {
    "type": "trade",
    "action": "buy | sell | swap | limit | stop | portfolio | balance | price",
    "asset": "BTC",
    "quote_currency": "USDT",
    "amount": 500,
    "amount_type": "quote | base | percent",
    "condition": null,
    "confidence": 0.95
  }
  ```
- [ ] Stage 1 — classify message: trade intent vs regular chat (confidence threshold)
- [ ] Stage 2 — extract structured parameters (JSON mode / structured output)
- [ ] Confidence thresholds: <0.5 = chat, 0.5-0.8 = clarify, >0.8 = proceed to confirmation
- [ ] Route trade intents to engine, regular messages to LLM as before
- [ ] Tests: fuzzing parser with ambiguous messages to prevent accidental trades

### 1.3 Confirmation Flow

State machine for trade confirmations.

- [ ] Define states: `CREATED -> SHOWN -> CONFIRMED -> EXECUTING -> DONE | CANCELLED | EXPIRED | FAILED`
- [ ] DB table `pending_confirmations` (user_id, intent, state, created_at, expires_at)
- [ ] Confirmation card: asset, amount, price, fee, total + [Confirm] [Cancel] buttons
- [ ] Timeout: auto-cancel after 60s (configurable)
- [ ] Confirmation levels:
  - Normal (<$500): single button
  - Large (>$500): manual amount re-entry
  - Critical (>$5000 or "sell all"): re-entry + delayed re-confirm
- [ ] Prevent double-click execution
- [ ] Persist pending confirmations across bot restarts

---

## Phase 2 — First Exchange (Trading MVP)

### 2.1 Provider Interface

- [ ] Define `Provider` ABC in `providers/base.py`:
  - `connect(credentials) -> bool`
  - `get_balance() -> list[Balance]`
  - `get_price(symbol) -> Decimal`
  - `market_order(symbol, side, amount) -> Order`
  - `limit_order(symbol, side, amount, price) -> Order`
  - `cancel_order(order_id) -> bool`
  - `get_orders() -> list[Order]`
- [ ] Define shared types: `Order`, `Balance`, `Position`
- [ ] Auto-discovery: scan `providers/` for Provider subclasses

### 2.2 Binance Provider (via ccxt)

- [ ] Implement `providers/binance.py`
- [ ] Market orders, limit orders
- [ ] Balance retrieval, portfolio
- [ ] Price fetching
- [ ] Add `ccxt` to requirements

### 2.3 Key Management

- [ ] AES-256 encryption for API keys with user master password
- [ ] DB table `user_credentials` (user_id, provider, encrypted_key, encrypted_secret)
- [ ] Keys decrypted only at execution time, never sent to LLM
- [ ] `/connect binance` command flow: request key + secret in DM -> encrypt -> store
- [ ] `/disconnect binance` to remove credentials

### 2.4 Core Trading Commands

- [ ] `"show portfolio"` -> aggregated balance with prices
- [ ] `"buy BTC for $500"` -> confirmation card -> market order
- [ ] `"sell half my ETH"` -> calculate 50% -> confirmation -> execute
- [ ] `"limit order SOL at $150"` -> limit order
- [ ] `"my open orders"` -> list
- [ ] `"cancel order #123"` -> cancel

---

## Phase 3 — Security & Risk Management

### 3.1 Risk Controls

- [ ] Max order size (configurable, default $1000)
- [ ] Rate limiting (max N orders per minute)
- [ ] Margin trading disabled by default
- [ ] Cooldown after large orders

### 3.2 Audit Log

- [ ] DB table `audit_log` (user_id, action, intent, result, timestamp)
- [ ] Full chain: intent -> confirmation -> execution -> result
- [ ] `"show my trade history"` command

### 3.3 Testing

- [ ] Paper trading mode (simulated execution)
- [ ] Integration tests with Binance testnet
- [ ] Intent parser fuzz tests

---

## Phase 4 — Multi-Exchange

- [ ] Bybit provider
- [ ] OKX provider
- [ ] Kraken provider
- [ ] Cross-exchange portfolio view
- [ ] Per-exchange `/connect` flow

---

## Phase 5 — DeFi

- [ ] Uniswap provider (web3.py)
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
5. **Plugin interface is simple** — one file = one provider. Community must be able to add exchanges.

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
