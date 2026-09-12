import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
export class JupiterSellTransactionBuilder {
    swapEndpoint;
    dryRun;
    constructor(swapEndpoint, dryRun) {
        this.swapEndpoint = swapEndpoint;
        this.dryRun = dryRun;
    }
    async buildSellTransaction(params) {
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
            return {
                serialized: tx.serialize(),
                transaction: tx,
                priorityFeeMicrolamports,
                minOutAmount: quote.minimumOutAmount
            };
        }
        const res = await fetch(this.swapEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                quoteResponse: quote.routeInfo,
                userPublicKey: wallet.toBase58(),
                dynamicComputeUnitLimit: true,
                prioritizationFeeLamports: {
                    priorityLevelWithMaxLamports: {
                        priorityLevel: "veryHigh",
                        maxLamports: Math.ceil(priorityFeeMicrolamports / 1_000_000)
                    }
                }
            })
        });
        if (!res.ok) {
            throw new Error(`Swap transaction build failed: ${res.status}`);
        }
        const body = (await res.json());
        if (!body.swapTransaction) {
            throw new Error("Swap response missing swapTransaction");
        }
        const tx = VersionedTransaction.deserialize(Buffer.from(body.swapTransaction, "base64"));
        return {
            serialized: tx.serialize(),
            transaction: tx,
            priorityFeeMicrolamports,
            minOutAmount: quote.minimumOutAmount
        };
    }
}
export const signBuiltTransaction = (built, wallet) => {
    if (!built.transaction) {
        throw new Error("Transaction object missing for signing");
    }
    built.transaction.sign([wallet]);
    return {
        ...built,
        serialized: built.transaction.serialize()
    };
};
