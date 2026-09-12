# Solana Exit Bot

Isolated token exit engine focused on fast risk-driven selling with default-safe operation (`DRY_RUN=true`).

## Features
- Position model with high/low watermark tracking
- Real-time market event ingestion with stale-data checks
- Deterministic risk trigger priority
- Hard stop-loss, falling-market score, trailing stop, and staged take-profit
- Idempotent sell executor with bounded retries and async confirmation tracking
- RPC endpoint failover scaffolding and WebSocket subscription recovery hooks
- Modes: `paper`, `dry-run`, `live`

## Safety Notes
No trading system can guarantee selling before a loss due to latency, liquidity changes, routing failures, MEV, and transaction uncertainty.

Never hardcode private keys. Use `WALLET_KEYPAIR_PATH` and keep `.env` local.

## Usage
```bash
cd solana-exit-bot
npm install
npm run dev
npm run test
npm run paper
npm run dry-run
npm run live
```

## Trigger Priority
1. EMERGENCY
2. LIQUIDITY_COLLAPSE
3. NO_VALID_ROUTE
4. RAPID_DECLINE
5. HARD_STOP_LOSS
6. TRAILING_STOP
7. TAKE_PROFIT
