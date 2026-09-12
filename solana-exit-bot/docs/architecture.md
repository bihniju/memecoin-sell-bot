# Architecture

## Pipeline

1. WebSocket provider (Solana or Helius)
2. Market event normalizer
3. Price/Liquidity monitors
4. Risk engine
5. Sell executor
6. Quote provider
7. Sell transaction builder
8. Transaction transport (RPC send + confirm)

## Core interfaces

- `MarketDataProvider`: `connect`, `subscribe`, `unsubscribe`, `disconnect`
- `QuoteProvider`: `getQuote` and `quoteForPosition`
- `SellTransactionBuilder`: `buildSellTransaction`
- `TransactionTransport`: `send`, `confirm`

## State model

`IDLE -> SELLING -> PARTIALLY_SOLD | SOLD | FAILED | UNKNOWN`

Only one active sell operation is allowed per mint.

## Latency metrics

The bot tracks:

- `marketEventAt`
- `riskDecisionAt`
- `quoteRequestedAt`
- `quoteReceivedAt`
- `transactionBuiltAt`
- `transactionSignedAt`
- `transactionSubmittedAt`
- `confirmationAt`

Derived metrics:

- `signalLatencyMs`
- `quoteLatencyMs`
- `buildLatencyMs`
- `submissionLatencyMs`
- `confirmationLatencyMs`
- `totalExitLatencyMs`
