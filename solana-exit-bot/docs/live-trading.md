# Live Trading

Live trading is opt-in and blocked by default.

## Required flags

- `MODE=live`
- `DRY_RUN=false`
- `LIVE_TRADING_ENABLED=true`

## Required configuration

- `RPC_ENDPOINT` (and optional failover endpoints)
- `WALLET_KEYPAIR_PATH`
- market data WebSocket endpoint(s)

## Wallet requirements

- use a local Solana keypair JSON file
- enforce strict permissions (`chmod 600`)
- never print secret key data

## Live execution behavior

- quotes are refreshed immediately before each sell attempt
- transaction is signed only in live mode
- send uses `sendRawTransaction`
- state becomes `SOLD` only after confirmation
- uncertain confirmation becomes `UNKNOWN`
