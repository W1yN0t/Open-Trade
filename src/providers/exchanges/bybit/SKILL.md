# Bybit Provider

## Credentials
- `apiKey` — Bybit API key
- `apiSecret` — Bybit API secret
- No password/passphrase required

## Symbol Format
`BASE/QUOTE` — e.g. `BTC/USDT`, `ETH/USDT`, `SOL/USDT`

## Supported Operations
- Spot market orders and limit orders
- Balance retrieval
- Price fetching via ticker
- Open orders listing and cancellation

## Limitations
- Spot trading only (`defaultType: 'spot'`) — no derivatives or perpetuals
- `cancelOrder` requires the symbol; it is cached in-memory from order history (lost on restart)
