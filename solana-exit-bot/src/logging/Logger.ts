import { BotConfig } from "../types.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export class Logger {
  constructor(private readonly level: BotConfig["logLevel"]) {}

  private emit(level: keyof typeof LEVELS, message: string, fields: object = {}): void {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const line = {
      ts: new Date().toISOString(),
      level,
      message,
      ...fields
    };
    process.stdout.write(`${JSON.stringify(line)}\n`);
  }

  debug(message: string, fields?: object): void { this.emit("debug", message, fields); }
  info(message: string, fields?: object): void { this.emit("info", message, fields); }
  warn(message: string, fields?: object): void { this.emit("warn", message, fields); }
  error(message: string, fields?: object): void { this.emit("error", message, fields); }
}
