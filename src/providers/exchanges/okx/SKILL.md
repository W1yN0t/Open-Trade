# OKX Provider

Exchange: OKX (okx.com)
Implementation: ccxt `okx` class

## Credentials

- `apiKey` — API key from OKX account settings
- `apiSecret` — API secret
- `password` — passphrase (OKX requires a trading password in addition to key/secret)

## Symbol format

OKX uses `BASE/QUOTE` format: `BTC/USDT`, `ETH/USDT`, `SOL/USDT`.

## Supported operations

- Spot market orders and limit orders
- Balance retrieval (all non-zero assets)
- Price fetching via ticker
- Open orders listing and cancellation

## Limitations

- Margin and futures trading not implemented
- `cancelOrder` requires the symbol — tracked internally via `orderSymbols` cache (in-memory, lost on restart)
- OKX `canceled` status maps to internal `cancelled` (note spelling difference)
