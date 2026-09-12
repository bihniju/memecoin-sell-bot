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

export class JupiterSellTransactionBuilder implements SellTransactionBuilder {
  constructor(
    private readonly swapEndpoint: string,
    private readonly dryRun: boolean,
    private readonly apiKey?: string
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

    const maxLamports = Math.max(1, Math.ceil(priorityFeeMicrolamports / 1_000_000));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
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
      throw new Error(`Jupiter swap build failed: ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ""}`);
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
  }
}

export const signBuiltTransaction = (built: BuiltTransaction, wallet: Keypair): BuiltTransaction => {
  if (!built.transaction) throw new Error("Transaction object missing for signing");
  built.transaction.sign([wallet]);
  return { ...built, serialized: built.transaction.serialize() };
};
