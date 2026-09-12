const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
export class Logger {
    level;
    constructor(level) {
        this.level = level;
    }
    emit(level, message, fields = {}) {
        if (LEVELS[level] < LEVELS[this.level])
            return;
        const line = {
            ts: new Date().toISOString(),
            level,
            message,
            ...fields
        };
        process.stdout.write(`${JSON.stringify(line)}\n`);
    }
    debug(message, fields) { this.emit("debug", message, fields); }
    info(message, fields) { this.emit("info", message, fields); }
    warn(message, fields) { this.emit("warn", message, fields); }
    error(message, fields) { this.emit("error", message, fields); }
}
