export class RetryManager {
    config;
    constructor(config) {
        this.config = config;
    }
    attempts() {
        return Array.from({ length: this.config.maxSellRetries }, (_, i) => i + 1);
    }
}
