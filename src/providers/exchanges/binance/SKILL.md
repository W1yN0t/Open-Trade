# Binance Provider

## Credentials
- `apiKey` — Binance API key
- `apiSecret` — Binance API secret
- No password/passphrase required

## Symbol Format
`BASE/QUOTE` — e.g. `BTC/USDT`, `ETH/USDT`, `SOL/USDT`

## Supported Operations
- Spot market orders and limit orders
- Balance retrieval
- Price fetching via ticker
- Open orders listing and cancellation

## Limitations
- Spot trading only — no margin or futures
- `cancelOrder` requires the symbol; it is cached in-memory from order history (lost on restart)
- US-restricted pairs may not be available depending on account region
