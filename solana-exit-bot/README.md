# Solana Exit Bot

Event-driven Solana position exit bot with paper, dry-run, and live modes. Default mode stays safe (`MODE=paper`, `DRY_RUN=true`, `LIVE_TRADING_ENABLED=false`).

## Architecture

WebSocket provider (Solana/Helius) → market event normalizer → price/liquidity monitors → risk engine → sell executor.

Critical path:

`MARKET EVENT -> UPDATE POSITION -> RISK EVALUATION -> EXIT DECISION -> FRESH QUOTE -> BUILD TRANSACTION -> SIGN -> SUBMIT -> CONFIRM`

## Installation

```bash
cd solana-exit-bot
npm install
npm run build
```

## Modes

- `MODE=paper`: simulated quotes/execution.
- `MODE=dry-run`: real market data + real quotes + transaction build; no signing/broadcast.
- `MODE=live`: real signing/broadcast/confirmation; requires `LIVE_TRADING_ENABLED=true`.

## Safety gates

Live mode starts only when all are true:

- `MODE=live`
- `DRY_RUN=false`
- `LIVE_TRADING_ENABLED=true`
- `WALLET_KEYPAIR_PATH` valid and readable
- at least one `RPC_ENDPOINT`

## Wallet setup

Use a local Solana keypair JSON file and set strict file permissions.

```bash
chmod 600 /path/to/id.json
export WALLET_KEYPAIR_PATH=/path/to/id.json
```

## Risk triggers (priority)

1. EMERGENCY
2. LIQUIDITY_COLLAPSE
3. NO_VALID_ROUTE
4. RAPID_DECLINE
5. HARD_STOP_LOSS
6. TRAILING_STOP
7. TAKE_PROFIT

## Priority fees

Supports:

- `fixed`
- `dynamic` (samples recent network prioritization fees)
- `emergency`

## Transaction flow

- fresh quote fetched immediately before each sell attempt
- quote guards: no route, stale quote, zero output, excessive impact, invalid amount
- transaction built with min-out and priority-fee context
- in live mode: sign + sendRawTransaction + confirmation tracking
- if confirmation is uncertain after timeout, state becomes `UNKNOWN`

## Failure handling

- RPC failover to healthy endpoints
- duplicate-send protection for same serialized transaction
- websocket reconnect + resubscribe
- stale market-data alerts

## Helius / WebSocket config

Set in `.env`:

- `WEBSOCKET_PROVIDER=solana|helius`
- `HELIUS_API_KEY`, `HELIUS_RPC_URL`, `HELIUS_WS_URL`
- `WEBSOCKET_ENDPOINT`, `WEBSOCKET_ENDPOINT_2`

## Benchmarking

```bash
npm run benchmark
```

Prints measured phase latencies for market event, risk evaluation, quote, build, submission, confirmation, and total.

## Security warnings

- never commit private keys
- never log secret key material
- keep `.env` local
- live trading is disabled by default

See also:

- `docs/architecture.md`
- `docs/live-trading.md`
- `docs/troubleshooting.md`
