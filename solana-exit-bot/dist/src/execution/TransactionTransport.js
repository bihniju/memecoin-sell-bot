export class SolanaTransactionTransport {
    rpcManager;
    options;
    sentByHash = new Map();
    constructor(rpcManager, options) {
        this.rpcManager = rpcManager;
        this.options = options;
    }
    async send(transaction) {
        const txHash = Buffer.from(transaction.serialized).toString("base64");
        const existing = this.sentByHash.get(txHash);
        if (existing) {
            return { signature: existing, endpoint: this.rpcManager.getActiveEndpoint(), duplicate: true };
        }
        const endpoint = this.rpcManager.getActiveEndpoint();
        const connection = this.rpcManager.getActiveConnection();
        const signature = await connection.sendRawTransaction(transaction.serialized, {
            skipPreflight: this.options.skipPreflight,
            maxRetries: this.options.maxRetries
        });
        this.sentByHash.set(txHash, signature);
        return { signature, endpoint, duplicate: false };
    }
    async confirm(signature) {
        const start = Date.now();
        const endpoints = this.rpcManager.getEndpointsInPriorityOrder();
        while (Date.now() - start < this.options.confirmationTimeoutMs) {
            for (const endpoint of endpoints) {
                const connection = this.rpcManager.getConnection(endpoint);
                const status = await this.confirmOnConnection(connection, signature);
                if (status === "confirmed")
                    return "confirmed";
                if (status === "failed")
                    return "failed";
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        return "unknown";
    }
    async confirmOnConnection(connection, signature) {
        try {
            const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
            const value = status.value;
            if (!value)
                return "unknown";
            if (value.err)
                return "failed";
            if (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized")
                return "confirmed";
            return "unknown";
        }
        catch {
            this.rpcManager.reportEndpointFailure(connection.rpcEndpoint);
            return "unknown";
        }
    }
}
