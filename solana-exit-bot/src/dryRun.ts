import { Connection, PublicKey } from "@solana/web3.js";
import { loadConfig } from "./config.js";
import { JupiterQuoteProvider } from "./execution/QuoteProvider.js";
import { JupiterSellTransactionBuilder } from "./execution/TransactionBuilder.js";
import { createPosition } from "./position/PositionState.js";

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Real dry-run requires ${name}`);
  return value;
};

const rpcUrl = (config: ReturnType<typeof loadConfig>): string =>
  config.rpc.rpcEndpoints[0] ?? config.rpc.heliusRpcUrl ?? "https://api.mainnet-beta.solana.com";

const main = async (): Promise<void> => {
  const config = loadConfig();
  if (config.mode !== "dry-run" || !config.dryRun) {
    throw new Error("Real dry-run requires MODE=dry-run and DRY_RUN=true");
  }
  if (config.wallet.liveTradingEnabled) throw new Error("Real dry-run refuses LIVE_TRADING_ENABLED=true");

  const walletAddress = requireEnv("WALLET_PUBLIC_KEY");
  const mintAddress = requireEnv("POSITION_MINT");
  const wallet = new PublicKey(walletAddress);
  const mint = new PublicKey(mintAddress);
  const connection = new Connection(rpcUrl(config), "confirmed");

  const solBalance = await connection.getBalance(wallet, "confirmed");
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet, { mint }, "confirmed");
  const tokenBalance = tokenAccounts.value.reduce((sum, account) => {
    const amount = account.account.data.parsed?.info?.tokenAmount?.amount;
    return sum + (typeof amount === "string" ? BigInt(amount) : 0n);
  }, 0n);
  if (tokenBalance <= 0n) throw new Error(`No token balance found for ${mintAddress}`);

  const quoteProvider = new JupiterQuoteProvider(
    config.market.quoteApiUrl,
    config.market.jupiterApiKey,
    { timeoutMs: config.execution.quoteRequestTimeoutMs ?? 900, retries: config.execution.quoteRetries ?? 2, cacheMs: 0 }
  );
  const decimals = Number(process.env.POSITION_DECIMALS ?? 6);
  const entryPrice = Number(process.env.POSITION_ENTRY_PRICE ?? 1);
  const position = createPosition({
    mint: mintAddress,
    decimals,
    walletAddress,
    amount: Number(process.env.POSITION_AMOUNT ?? 1),
    amountRaw: tokenBalance,
    entryPrice
  });

  const quoteStarted = Date.now();
  const quote = await quoteProvider.quoteForPosition(position, config.market.outputMint, 100, config.execution.quoteSlippageBps, { fresh: true });
  const quoteLatencyMs = Date.now() - quoteStarted;
  if (!quote.routeAvailable || !quote.routeInfo) throw new Error("Real dry-run received no executable Jupiter route");
  if (quote.expectedOutAmount <= 0n || quote.minimumOutAmount <= 0n) throw new Error("Real dry-run received invalid Jupiter output");
  if (!Number.isFinite(quote.priceImpactBps) || quote.priceImpactBps < 0) throw new Error("Real dry-run received invalid price impact");

  const builder = new JupiterSellTransactionBuilder(
    config.market.swapApiUrl,
    false,
    config.market.jupiterApiKey,
    { timeoutMs: (config.execution.quoteRequestTimeoutMs ?? 900) + 300, retries: 1 }
  );
  const buildStarted = Date.now();
  const built = await builder.buildSellTransaction({
    wallet,
    position,
    quote,
    priorityFeeMicrolamports: config.execution.minPriorityFeeMicrolamports
  });
  const buildLatencyMs = Date.now() - buildStarted;

  if (!built.recentBlockhash || built.lastValidBlockHeight === undefined || !built.transaction) {
    throw new Error("Real dry-run transaction is missing transaction/blockhash expiry metadata");
  }

  const simulationStarted = Date.now();
  const simulation = await connection.simulateTransaction(built.transaction, { sigVerify: false, replaceRecentBlockhash: false });
  const simulationLatencyMs = Date.now() - simulationStarted;
  if (simulation.value.err) throw new Error(`Real dry-run simulation failed: ${JSON.stringify(simulation.value.err)}`);

  console.log(JSON.stringify({
    mode: config.mode,
    broadcast: false,
    wallet: walletAddress,
    mint: mintAddress,
    solBalanceLamports: solBalance,
    tokenBalanceRaw: tokenBalance.toString(),
    quoteId: quote.quoteId,
    quoteLatencyMs,
    buildLatencyMs,
    simulationLatencyMs,
    expectedOutAmount: quote.expectedOutAmount.toString(),
    minimumOutAmount: quote.minimumOutAmount.toString(),
    priceImpactBps: quote.priceImpactBps,
    recentBlockhash: built.recentBlockhash,
    lastValidBlockHeight: built.lastValidBlockHeight,
    serializedBytes: built.serialized.length
  }, null, 2));
};

main().catch((error) => {
  console.error(`REAL_DRY_RUN_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
