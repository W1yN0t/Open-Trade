# 🦾 OpenTrade

> Trade anything. From anywhere. Just write.

---

## The Idea

OpenTrade is an open-source financial AI agent that lives in your messenger and completely replaces the exchange interface.

You write in plain text, in any language:

```
"buy BTC for $500"
"sell half of my ETH"
"set a limit order for SOL at $150"
"show my portfolio"
"cancel order 123456"
```

The agent understands your intent, shows a confirmation card with exact numbers, waits for your ✅, and executes the order. That's it.

---

## What's Working Now

- **Telegram bot** — full message loop with inline confirmation buttons
- **Exchanges** — OKX, Binance, Bybit (via ccxt)
- **LLM providers** — OpenRouter, OpenAI, Anthropic, Google Gemini, Ollama, LM Studio
- **Paper trading** — simulated $10k USDT balance, zero risk, identical UX
- **Risk controls** — max order size, rate limiting, large-order cooldown, margin block
- **Audit log** — every trade recorded end-to-end in Postgres
- **CLI** — manage exchange credentials and LLM models from the terminal; keys never pass through Telegram

---

## Quick Start

**Prerequisites:** Node.js 24+, PostgreSQL

```bash
git clone https://github.com/yourname/opentrade
cd opentrade
npm install
cp .env.example .env   # fill in TELEGRAM_BOT_TOKEN, DATABASE_URL, and your LLM key
npm run db:migrate
npm run dev
```

**Connect an exchange** (terminal only — keys never touch Telegram):
```bash
npm run cli connect okx      # prompts for API key, secret, passphrase
npm run cli connections       # verify it's stored
npm run cli test okx          # test the connection
```

**Switch LLM model:**
```bash
npm run cli model use claude-3-5-sonnet-20241022   # runs smoke test before activating
npm run cli models                                  # list installed Ollama models
npm run cli model pull llama3.2                     # pull from Ollama
```

---

## LLM Providers

Set `LLM_PROVIDER` in `.env`:

| Provider | Env var | Notes |
|---|---|---|
| `openrouter` (default) | `LLM_API_KEY` | Access 100+ models via one key |
| `openai` | `OPENAI_API_KEY` | Direct OpenAI API |
| `anthropic` | `ANTHROPIC_API_KEY` | Direct Anthropic API |
| `gemini` | `GEMINI_API_KEY` | Direct Google Gemini API |
| `ollama` | `OLLAMA_BASE_URL` | Local, fully private |
| `lmstudio` | `LM_STUDIO_BASE_URL` | Local, fully private |

Local providers are health-checked on startup and fall back to OpenRouter if unreachable.

---

## Philosophy

**No UI** — trade from where you already are: Telegram, Discord, WhatsApp

**Any asset** — crypto, stocks, DeFi in one chat

**Full control** — self-hosted, your keys never leave your machine

**Open source** — audit every single line of code that touches your money

**Natural language** — write how you think, in any language

---

## How It Works

```
You send a message
        ↓
LLM parses the intent (confidence threshold: <0.8 → clarify, ≥0.8 → confirm)
        ↓
Agent fetches real-time data (prices, balances)
        ↓
Shows confirmation card with exact numbers
        ↓
You confirm ✅  (large orders require retyping the amount; critical orders need two confirmations)
        ↓
Risk checks pass → order executes on exchange
        ↓
Result + audit record in chat
```

---

## Safety

- **Confirmation for every trade** — no auto-execution path exists anywhere in the code
- **Tiered confirmation** — normal (<$500): one ✅ · large ($500–$5000): retype amount · critical (>$5000 or "sell all"): retype + second ✅
- **Risk controls** — configurable max order size, per-minute rate limit, post-large-order cooldown
- **Encrypted keys** — AES-256-GCM with a master password; decrypted only at execution time, never stored in memory or sent to the LLM
- **Paper mode** — `PAPER_TRADING=true` for zero-risk testing with identical UX

---

## Adding an Exchange

1. Create `src/providers/exchanges/<name>/provider.ts` extending `Provider`
2. Implement `connect`, `getBalance`, `getPrice`, `marketOrder`, `limitOrder`, `cancelOrder`, `getOrders`
3. Create `src/providers/exchanges/<name>/SKILL.md` with exchange-specific LLM instructions
4. Done — the provider is auto-discovered at startup, no registration needed

---

## Stack

- **Runtime:** Node.js 24 + TypeScript 5
- **Telegram:** grammY
- **LLM:** Vercel AI SDK (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`)
- **Exchanges:** ccxt
- **Database:** PostgreSQL + Prisma
- **Tests:** Vitest

---

## License

MIT — use, modify, and distribute freely.
