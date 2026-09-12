# Troubleshooting

## WebSocket reconnect loops

- verify `WEBSOCKET_ENDPOINT` / `HELIUS_WS_URL`
- verify network/firewall access
- check stale-data warnings in logs

## No route / liquidity collapse

- verify token mint correctness
- inspect quote output and `priceImpactBps`
- check `MAX_PRICE_IMPACT_BPS`

## Transactions not reaching SOLD

- if confirmation times out, state is `UNKNOWN`
- inspect RPC endpoint health and signature status
- verify preflight and retry settings

## Live mode refused to start

- ensure `LIVE_TRADING_ENABLED=true`
- ensure `MODE=live` and `DRY_RUN=false`
- ensure `WALLET_KEYPAIR_PATH` exists and permission is owner-only

## Dry-run behavior

- dry-run builds transactions but does not sign/broadcast
- use logs to inspect expected output, risk trigger, and latency
