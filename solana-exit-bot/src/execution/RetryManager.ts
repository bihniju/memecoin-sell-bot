import { ExecutionConfig } from "../types.js";

export class RetryManager {
  constructor(private readonly config: ExecutionConfig) {}

  attempts(): number[] {
    return Array.from({ length: this.config.maxSellRetries }, (_, i) => i + 1);
  }
}
