import { config } from "../config/config.js";

type LogLevel = "debug" | "info" | "success" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	success: 2,
	warn: 3,
	error: 4,
};

const COLOR: Record<LogLevel, string> = {
	debug: "\x1b[90m",
	info: "\x1b[34m",
	success: "\x1b[32m",
	warn: "\x1b[33m",
	error: "\x1b[31m",
};

const RESET = "\x1b[0m";

function ramUsage(): string {
	const mb = process.memoryUsage().rss / 1024 / 1024;
	return `${mb.toFixed(1)}MB`;
}

class Logger {
	private readonly minLevel: LogLevel;
	private readonly timezone: string;

	constructor() {
		this.minLevel = config.logging.level;
		this.timezone = config.logging.timezone;
	}

	private _log(level: LogLevel, context: string, message: string, error?: Error): void {
		if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) return;

		const now = new Date();
		const ts = now.toLocaleString("en-IN", {
			timeZone: this.timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});

		const consoleLine = `${COLOR[level]}[${ts}] [${level.toUpperCase()}] [${ramUsage()}] ${context}${RESET} ${message}`;
		const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
		stream.write(`${consoleLine}\n`);
		if (error) process.stderr.write(`${error.stack ?? error.message}\n`);
	}

	debug(context: string, message: string, error?: Error): void {
		this._log("debug", context, message, error);
	}

	info(context: string, message: string, error?: Error): void {
		this._log("info", context, message, error);
	}

	success(context: string, message: string, error?: Error): void {
		this._log("success", context, message, error);
	}

	warn(context: string, message: string, error?: Error): void {
		this._log("warn", context, message, error);
	}

	error(context: string, message: string, error?: Error): void {
		this._log("error", context, message, error);
	}
}

export const logger = new Logger();
