import { readFileSync, statSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
export const requireLiveTradingEnabled = (config) => {
    if (config.mode !== "live")
        return;
    if (config.dryRun) {
        throw new Error("MODE=live requires DRY_RUN=false");
    }
    if (!config.wallet.liveTradingEnabled) {
        throw new Error("MODE=live requires LIVE_TRADING_ENABLED=true");
    }
    if (!config.wallet.walletKeypairPath) {
        throw new Error("MODE=live requires WALLET_KEYPAIR_PATH");
    }
    if (config.rpc.rpcEndpoints.length === 0) {
        throw new Error("MODE=live requires at least one RPC_ENDPOINT");
    }
};
export const loadWalletKeypair = (config) => {
    if (!config.wallet.walletKeypairPath)
        return;
    const stats = statSync(config.wallet.walletKeypairPath);
    const fileMode = stats.mode & 0o777;
    if (fileMode & 0o077) {
        throw new Error("WALLET_KEYPAIR_PATH has insecure permissions; expected owner-only access");
    }
    const raw = readFileSync(config.wallet.walletKeypairPath, "utf8");
    const secret = JSON.parse(raw);
    if (!Array.isArray(secret) || secret.length < 32) {
        throw new Error("Invalid keypair file format");
    }
    return Keypair.fromSecretKey(Uint8Array.from(secret));
};
