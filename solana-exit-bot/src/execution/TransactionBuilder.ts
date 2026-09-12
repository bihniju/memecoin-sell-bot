import { BuiltTransaction, Position, Quote } from "../types.js";

export class TransactionBuilder {
  build(position: Position, quote: Quote, priorityFeeMicrolamports: number): BuiltTransaction {
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
