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
"buy AAPL if it drops to $180"
"swap ETH to USDC"
"show my portfolio"
```

The agent understands your intent, shows a confirmation card with exact numbers, waits for your ✅, and executes the order. That's it.

---

## The Problem We're Solving

Exchange interfaces are complex and intimidating. Binance, Bybit, OKX — dozens of menus, charts, and forms to learn. Stock brokers require separate apps. DeFi wallets add another layer of complexity.

Millions of people want to trade but are scared of the UI. OpenTrade removes the interface entirely — leaving only intent and result.

---

## Philosophy

**No UI** — trade from where you already are: Telegram, Discord, WhatsApp

**Any asset** — crypto, stocks, DeFi in one chat, one agent for everything

**Full control** — self-hosted, your keys never leave your machine

**Open source** — audit every single line of code that touches your money

**Natural language** — write how you think, in any language

---

## How It Works

```
You send a message
        ↓
LLM parses the intent via Vercel AI SDK (Claude / GPT / DeepSeek / Gemini / Ollama)
        ↓
Agent fetches real-time data (prices, balances, fees)
        ↓
Shows confirmation card
        ↓
You confirm ✅
        ↓
Order executes on chosen exchange / broker / DEX
        ↓
Notification in chat
```

---

## Core Principles

### 🎯 Confirmation for every trade
The agent never executes a financial operation without explicit user confirmation. Different levels for different amounts: simple ✅ for regular trades, double confirmation for large orders, cancellation timeout if you don't respond.

### 🔌 Plugin architecture
Every exchange, broker, wallet, and DEX is a separate provider with a unified interface. Adding a new integration is a single file. The community extends the ecosystem itself.

### 🤖 Any AI provider
Users choose which model to work with — Claude, GPT, Gemini, DeepSeek, or local via Ollama. The agent is not locked to any single vendor.

### 📱 Any messenger
One engine, different channels. Telegram, Discord, WhatsApp, Signal, iMessage. Unified interface for all of them.

### 🔐 Self-hosted and private
Exchange API keys are encrypted locally and never sent to any third-party server. Run the agent on your own machine — or even on a Raspberry Pi at home.

---

## The Vision

**One agent** — a single entry point to all financial markets

**Any messenger** — trade from the chat where you already talk to friends

**Any asset** — crypto, stocks, DeFi, wallets

**Any AI** — pick the model that fits your needs

**Any exchange** — 100+ exchanges out of the box via ccxt

This isn't a trading bot. This is **the universal financial interface for the AI era**.

---

## Status

🚧 Project is under active development. Follow the progress — public build log on Twitter/X.

---

## License

MIT — use, modify, and distribute freely.
