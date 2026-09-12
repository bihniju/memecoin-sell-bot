import { ComputeBudgetProgram, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { BuiltTransaction, Position, Quote } from "../types.js";

export interface SellTransactionBuilder {
  buildSellTransaction(params: {
    wallet: PublicKey;
    position: Position;
    quote: Quote;
    priorityFeeMicrolamports: number;
  }): Promise<BuiltTransaction>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class JupiterSellTransactionBuilder implements SellTransactionBuilder {
  constructor(
    private readonly swapEndpoint: string,
    private readonly dryRun: boolean,
    private readonly apiKey?: string,
    private readonly options: { timeoutMs?: number; retries?: number } = {}
  ) {}

  async buildSellTransaction(params: {
    wallet: PublicKey;
    position: Position;
    quote: Quote;
    priorityFeeMicrolamports: number;
  }): Promise<BuiltTransaction> {
    const { wallet, quote, priorityFeeMicrolamports } = params;

    if (this.dryRun || quote.provider === "simulated") {
      const message = new TransactionMessage({
        payerKey: wallet,
        recentBlockhash: "11111111111111111111111111111111",
        instructions: [
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicrolamports }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })
        ]
      }).compileToV0Message([]);
      const tx = new VersionedTransaction(message);
      return { serialized: tx.serialize(), transaction: tx, priorityFeeMicrolamports, minOutAmount: quote.minimumOutAmount };
    }

    if (!quote.routeInfo || typeof quote.routeInfo !== "object") {
      throw new Error("Jupiter quote response is missing route information");
    }

    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    // Jupiter expects maxLamports as a total prioritization budget, while the bot
    // config expresses priority fee as micro-lamports per compute unit.
    const estimatedComputeUnits = 200_000;
    const maxLamports = Math.max(10_000, Math.ceil((priorityFeeMicrolamports * estimatedComputeUnits) / 1_000_000));
    const attempts = Math.max(1, Math.trunc(this.options.retries ?? 1) + 1);
    const timeoutMs = Math.max(500, this.options.timeoutMs ?? 1_200);
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
          res = await fetch(this.swapEndpoint, {
            method: "POST",
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              quoteResponse: quote.routeInfo,
              userPublicKey: wallet.toBase58(),
              wrapAndUnwrapSol: true,
              dynamicComputeUnitLimit: true,
              prioritizationFeeLamports: {
                priorityLevelWithMaxLamports: {
                  priorityLevel: "veryHigh",
                  maxLamports
                }
              }
            })
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          if (res.status < 500 && res.status !== 429) {
            throw new Error(`Jupiter swap build failed: ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ""}`);
          }
          throw new Error(`Jupiter swap build transient failure: ${res.status}`);
        }

        const body = (await res.json()) as { swapTransaction?: string };
        if (!body.swapTransaction) throw new Error("Jupiter swap response missing swapTransaction");
        const tx = VersionedTransaction.deserialize(Buffer.from(body.swapTransaction, "base64"));
        return {
          serialized: tx.serialize(),
          transaction: tx,
          priorityFeeMicrolamports,
          minOutAmount: quote.minimumOutAmount
        };
      } catch (error) {
        lastError = error;
        if (attempt + 1 < attempts) await sleep(50 * 2 ** attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

export const signBuiltTransaction = (built: BuiltTransaction, wallet: Keypair): BuiltTransaction => {
  if (!built.transaction) throw new Error("Transaction object missing for signing");
  built.transaction.sign([wallet]);
  return { ...built, serialized: built.transaction.serialize() };
};
