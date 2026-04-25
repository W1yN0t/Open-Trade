# Kraken Provider

## Credentials
- `apiKey` — Kraken API key
- `apiSecret` — Kraken API secret (called "Private Key" in Kraken UI)
- No password/passphrase required

## Symbol Format
`BASE/QUOTE` — e.g. `BTC/USDT`, `ETH/USDT`, `SOL/USDT`

CCXT normalizes Kraken's internal asset names (XXBT → BTC, XETH → ETH) automatically.

## Supported Operations
- Spot market orders and limit orders
- Balance retrieval
- Price fetching via ticker
- Open orders listing and cancellation

## Limitations
- Spot trading only — no margin or futures
- No official testnet; integration tests require real API keys
- `cancelOrder` requires the symbol; it is cached in-memory from order history (lost on restart)
- Some trading pairs may require KYC verification level 2+
