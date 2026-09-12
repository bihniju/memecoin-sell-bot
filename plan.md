# Solana Exit Bot — Production Hardening Plan

> Tracking plan for making the exit path resilient under rugs, liquidity collapse, RPC congestion, WebSocket failures, Jupiter failures, blockhash expiry, and confirmation uncertainty.
>
> **Safety rule:** live trading stays disabled unless explicitly enabled outside CI. No task in this plan should require a private key or secret to be committed to the repository.

## Status legend

- [ ] Not started
- [~] In progress
- [x] Complete
- [!] Blocked / needs investigation

## P0 — Transaction correctness and blockhash expiry

### 1. Execution attempt model
- [x] Add a first-class `ExecutionAttempt` model.
- [x] Track execution ID, position ID, quote ID, transaction hash, blockhash, and `lastValidBlockHeight`.
- [x] Track build/sign/submit/processed/confirmed/finalized/expiry timestamps.
- [x] Track rebuild count, RPC endpoint, status, and reconciliation result.
- [x] Preserve the original exit trigger across rebuilds.

### 2. Preserve Jupiter transaction metadata
- [x] Preserve `lastValidBlockHeight` from the Jupiter swap/build response.
- [x] Preserve the transaction's recent blockhash.
- [x] Carry expiry metadata from transaction builder into transport/execution state.
- [x] Add validation for missing or malformed expiry metadata.

### 3. Detect blockhash expiry before broadcast
- [x] Check current block height against `lastValidBlockHeight` before sending.
- [x] Refuse to broadcast a transaction that is already expired.
- [x] Ensure an expired transaction is never resent unchanged.

### 4. Expiry-aware confirmation
- [x] Monitor signature status while the transaction is still valid.
- [x] Check block height while waiting for confirmation.
- [x] Distinguish `UNKNOWN`, `FAILED`, `CONFIRMED`, and `EXPIRED`.
- [x] Treat RPC timeout as uncertainty, not failure.

### 5. Reconciliation before rebuild
- [x] When status becomes `UNKNOWN`, reconcile across healthy RPC endpoints before rebuilding.
- [x] Check signature history/status before creating another transaction.
- [x] Reconcile token balance/position state where required.
- [x] Never rebuild while the previous execution could still have landed without first reconciling.
- [x] Fail closed when signature or balance reconciliation is unavailable/ambiguous.

### 6. Safe rebuild flow
- [x] Rebuild only after the previous attempt is known expired/absent and reconciliation permits it.
- [x] Request a fresh Jupiter quote before every rebuild.
- [x] Build with a fresh recent blockhash and fresh expiry height.
- [x] Ensure rebuilt transaction bytes differ when the blockhash changes.
- [x] Prevent duplicate rebuilds for the same execution/position.

### 7. P0 tests
- [x] Expired before send.
- [x] Expiry while confirming.
- [x] RPC timeout but transaction later lands.
- [x] Timeout + transaction absent while transaction is still valid.
- [x] Expired + absent → rebuild.
- [x] Expired + confirmed through another RPC → mark sold, do not rebuild.
- [x] Duplicate execution ID cannot create duplicate sells.
- [x] Rebuild always uses a fresh quote.
- [x] Rebuild always uses a fresh blockhash/expiry.
- [x] Old serialized transaction is never resent after expiry.
- [x] UNKNOWN confirmation is reconciled before terminal position state is accepted.
- [x] Ambiguous/unavailable reconciliation remains UNKNOWN and cannot trigger a rebuild.
- [x] Signature failure cannot be mistaken for a successful sell.
- [x] Signature lookup failure can fail over to another RPC endpoint.

## P0 — Real Solana/Jupiter dry-run

### 8. Read-only production-path dry run
- [x] Add a clearly named real dry-run mode that never broadcasts.
- [x] Connect to a real Solana RPC using environment configuration.
- [x] Fetch real wallet/token balances without requiring signing.
- [x] Request real Jupiter quotes.
- [x] Validate route, output, slippage, price impact, timestamps, and amount bounds.
- [x] Build and deserialize the real transaction response.
- [x] Inspect blockhash and expiry metadata.
- [x] Optionally simulate the transaction without broadcasting.
- [x] Record latency for quote/build/simulation stages.

### 9. Dry-run safety tests
- [x] Assert real dry-run cannot call `sendRawTransaction`.
- [x] Assert CI/test environments cannot accidentally enter live mode.
- [x] Test Jupiter 429, 5xx, timeout, malformed response, and no-route behavior.
- [x] Test RPC timeout, rate limiting, stale endpoint, and unavailable endpoint behavior.

### 9A. Cloud validation
- [x] Add a manual GitHub Actions workflow for the real mainnet dry-run.
- [x] Run build, audit, and unit tests before the real dry-run step.
- [x] Force `MODE=dry-run`, `DRY_RUN=true`, and `LIVE_TRADING_ENABLED=false` in CI.
- [x] Execute the workflow against the target wallet and held token mint.
- [x] Review the complete workflow result: run `34704859918`, job `103582971470`, all steps successful.
- [x] Confirm zero broadcast capability was exercised; the run completed through quote/build/simulation with dry-run safety enabled.

## P1 — Liquidity and rug detection

### 10. Executable liquidity risk engine
- [ ] Create a dedicated `LiquidityRiskEngine`.
- [ ] Measure executable sell depth at multiple position sizes (for example 10%, 25%, 50%, 100%).
- [ ] Detect route disappearance.
- [ ] Detect sharp deterioration in expected output.
- [ ] Detect rapidly increasing price impact.
- [ ] Use actual pool/account liquidity data where reliably available.
- [ ] Avoid treating a single failed quote as definitive proof of a rug.

### 11. Composite rug/crash score
- [ ] Combine quote deterioration, route availability, price impact, sell depth, price velocity, and market-data freshness.
- [ ] Define LOW/MEDIUM/HIGH/CRITICAL risk levels.
- [ ] Add configurable emergency thresholds.
- [ ] Add tests for genuine liquidity collapse and false-positive recovery.

## P1 — RPC resilience under load

### 12. Failover hardening
- [~] Test multiple RPC endpoints under normal and degraded conditions.
- [x] Handle timeout-like failures, 429/5xx health failures, unavailable endpoints, and connection failure paths.
- [x] Test endpoint recovery and cooldown behavior.
- [x] Test endpoint flapping and stale health information.
- [x] Bound RPC send time so a slow/hanging endpoint cannot block the exit path indefinitely; uncertain submissions remain subject to reconciliation and are never blindly resent.
- [x] Add tests proving an uncertain timed-out/5xx submission does not trigger a blind second broadcast.
- [ ] Complete cloud load validation across multiple RPC endpoints under sustained/concurrent exit load.

### 13. Load tests
- [ ] Benchmark 10 exits/sec.
- [ ] Benchmark 25 exits/sec.
- [ ] Benchmark 50 exits/sec.
- [ ] Benchmark 100 exits/sec.
- [ ] Measure queue growth, latency, errors, duplicate prevention, and memory usage.
- [ ] Publish/record the benchmark results and use them to set safe operating limits.

> **CI note:** workflow run `34726228617` failed before the RPC benchmark because TypeScript compilation found a missing `Position.walletAddress` fixture field. The fixture was corrected in commit `efbb14f6110541cfe38851be56f5f8e3a58cbfa2`; that correction has not yet been validated by a completed RPC-load workflow run, so the load milestone remains open.

## P1 — Confirmation resilience

### 14. Confirmation resilience
- [ ] Reduce dependence on fixed 200ms confirmation polling.
- [ ] Use immediate status checks followed by short adaptive polling.
- [ ] Test submission success + confirmation failure.
- [ ] Test confirmation through a different RPC endpoint.
- [ ] Test delayed landing after initial timeout.

## P1 — Transaction confirmation state machine

### 15. Explicit execution states
- [ ] Define and enforce: `BUILT`, `SIGNED`, `SUBMITTED`, `PROCESSING`, `CONFIRMED`, `FINALIZED`, `FAILED`, `EXPIRED`, `UNKNOWN`, `RECONCILING`, `REBUILT`.
- [ ] Define legal transitions.
- [ ] Reject impossible/out-of-order state transitions.
- [ ] Persist enough state to recover safely after process restart.

### 16. Confirmation edge cases
- [ ] RPC accepts transaction but it never lands.
- [ ] Send request times out but transaction lands.
- [ ] Signature reports failure.
- [ ] Blockhash expires.
- [ ] Transaction lands through another endpoint.
- [ ] Partial fill changes the remaining position.
- [ ] Duplicate market/confirmation events.
- [ ] Out-of-order RPC responses.

## P1 — Latency instrumentation and benchmarking

### 17. End-to-end timestamps
Track at minimum:

`T0 market event → T1 risk decision → T2 quote request → T3 quote received → T4 build → T5 sign → T6 broadcast → T7 processed → T8 confirmed → T9 finalized`

- [ ] Record each timestamp on `ExecutionAttempt`.
- [ ] Calculate stage latency and total latency.
- [ ] Report p50, p75, p90, p95, p99, and max.

### 18. Benchmark scenarios
- [ ] Cold start.
- [ ] Warm exit path.
- [ ] RPC latency: 100/250/500/1000ms.
- [ ] Jupiter latency: 100/300/500/900ms.
- [ ] Jupiter timeout.
- [ ] Jupiter 429/5xx.
- [ ] WebSocket disconnect/reconnect.
- [ ] RPC failover.
- [ ] Blockhash nearing expiry.
- [ ] Concurrent exit bursts.

## P1 — WebSocket resilience and soak testing

### 19. WebSocket chaos
- [ ] Kill active socket.
- [ ] Delay socket messages.
- [ ] Send stale events.
- [ ] Reconnect and resubscribe.
- [ ] Ensure stale sockets cannot emit events into the active session.
- [ ] Verify emergency behavior when market data becomes stale.

### 20. Long-running soak
- [ ] Run at least 1-hour simulated soak.
- [ ] Generate 10,000+ market events.
- [ ] Generate 1,000+ simulated exit decisions.
- [ ] Monitor memory, timers, listeners, queues, RPC health state, and WebSocket subscriptions.
- [ ] Verify no duplicate sells or corrupted position state.

## P2 — Jupiter API modernization

### 21. Evaluate current Jupiter APIs
- [ ] Benchmark the existing Swap V1 integration.
- [ ] Evaluate Jupiter Swap V2 Router (`/build` / `/submit`).
- [ ] Evaluate managed execution/Ultra where it provides a measurable landing advantage.
- [ ] Compare latency, reliability, rate limits, control, failure behavior, and observability.
- [ ] Do not migrate solely because an API is newer; benchmark the actual exit path first.

## P2 — Full chaos and shadow mode

### 22. Combined failure scenario
Simulate:

1. Market crashes ~40%.
2. WebSocket disconnects.
3. RPC-A times out.
4. RPC-B becomes congested.
5. Jupiter price impact increases.
6. Transaction is built.
7. Blockhash approaches expiry.
8. RPC-B rejects/does not land the transaction.
9. RPC-C receives the transaction.
10. Confirmation is delayed.
11. Transaction eventually lands.

- [ ] Verify exactly one execution outcome is recorded.
- [ ] Verify no duplicate broadcast.
- [ ] Verify position state reconciles correctly.

### 23. Shadow mode
- [ ] Real market events.
- [ ] Real Jupiter quotes.
- [ ] Real RPC reads.
- [ ] Real risk decisions.
- [ ] Real transaction construction.
- [ ] **No transaction broadcast.**
- [ ] Record what would have happened, including estimated output and latency.

## P3 — Controlled live readiness

Only begin after all P0/P1 gates pass.

- [ ] Live trading remains disabled by default.
- [ ] Explicit wallet and configuration required.
- [ ] Tiny test position only.
- [ ] Maximum position size.
- [ ] Maximum loss per execution/day.
- [ ] Maximum number of sells.
- [ ] Kill switch.
- [ ] Startup/restart reconciliation.
- [ ] Full audit trail.
- [ ] Manual approval before first live execution.

## Definition of done

- [x] Blockhash expiry is detected correctly.
- [x] Expired transactions are never blindly resent.
- [x] Expiry triggers fresh quote + fresh build + fresh blockhash.
- [x] `UNKNOWN` is reconciled before rebuilding.
- [x] Duplicate broadcasts are prevented.
- [x] Real Jupiter quote/build/simulation path works in dry-run.
- [ ] RPC failover survives load and degraded endpoints.
- [ ] Confirmation edge cases have deterministic outcomes.
- [ ] Liquidity/rug deterioration is detected without relying on one signal.
- [ ] WebSocket reconnect/resubscribe is reliable.
- [ ] p50/p95/p99 exit latency is measured.
- [ ] Chaos and soak tests pass.
- [ ] Shadow mode works with zero broadcast capability.
- [x] Live trading remains off by default.

## Recommended implementation order

1. [x] ExecutionAttempt + blockhash/expiry metadata.
2. [x] Expiry-aware transport and confirmation.
3. [x] Reconciliation and safe rebuild orchestration.
4. [x] P0 expiry/confirmation tests.
5. [x] Real Jupiter/Solana dry-run.
6. [~] RPC failover/load tests — implementation and failure-path coverage are substantially complete; cloud load validation is still pending.
7. [ ] Latency instrumentation.
8. [ ] Latency benchmarks.
9. [ ] Liquidity/rug engine.
10. [ ] WebSocket chaos + soak.
11. [ ] Jupiter V2 evaluation.
12. [ ] Full combined chaos.
13. [ ] Shadow mode.
14. [ ] Controlled live readiness review.

## Current milestone

**Branch:** `p0-real-dry-run`  
**Current focus:** Finish P1 RPC resilience validation. The code now bounds hanging RPC sends, fails closed on ambiguous reconciliation, uses endpoint health/cooldown/latency prioritization, and has tests for timeout/429/5xx/unavailable/failover and duplicate-broadcast prevention. The remaining RPC gate is the actual 10/25/50/100 exits-per-second load validation and a completed cloud run on the corrected commit. After that, move to latency instrumentation and benchmarking, then liquidity/rug detection.  
**Latest successful real mainnet validation:** GitHub Actions run `34704859918`, job `103582971470` — build, audit, 61/61 unit tests, real Jupiter quote/build/simulation, and dry-run safety gate all passed.  
**Latest RPC-load failure:** run `34726228617` — failed at build before benchmark execution; the specific `Position.walletAddress` fixture issue was corrected in `efbb14f6110541cfe38851be56f5f8e3a58cbfa2`.  
**Live trading:** OFF.
