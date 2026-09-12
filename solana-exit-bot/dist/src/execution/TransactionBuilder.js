export class TransactionBuilder {
    build(position, quote, priorityFeeMicrolamports) {
        const payload = {
            mint: position.mint,
            inAmount: quote.inAmount,
            minOutAmount: quote.outAmount,
            priorityFeeMicrolamports,
            at: Date.now()
        };
        return {
            serialized: Buffer.from(JSON.stringify(payload)).toString("base64"),
            priorityFeeMicrolamports
        };
    }
}
