// Logging: each file takes its own logger with getLogger("category") at the top.
//
// Configuration (.env):
//   LOG_LEVEL=info               default minimum level of every category
//   LOG_LEVEL_<CATEGORY>=debug   minimum level of one category (e.g. LOG_LEVEL_HTTP=warn, LOG_LEVEL_USERSCRIPT=debug)
//   LOG_FILE=dist/logs.log       file the lines are appended to ("" or "off" disables the file)
//   LOG_CONSOLE=1                also print the lines on stdout/stderr (0 to disable)
// Levels: debug < info < warn < error < critical; "off" (or "none") silences a category.

import "dotenv/config";
import { appendFileSync, createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { inspect } from "node:util";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "critical"] as const;
export type LogLevel = typeof LOG_LEVELS[number];
const RANK: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3, critical: 4, off: 5, none: 5 };
const DEFAULT_LEVEL = "info";

/** Parses a level name; unknown values fall back to the given default (with a warning, once). */
function parseLevel(value: string | undefined, fallback: number, source: string): number {
	if (value === undefined || value.trim() === "") return fallback;
	const rank = RANK[value.trim().toLowerCase()];
	if (rank !== undefined) return rank;
	process.stderr.write(`[logger] ${source}="${value}" is not a level (${LOG_LEVELS.join(", ")}, off): ignored\n`);
	return fallback;
}

const envKey = (category: string) => `LOG_LEVEL_${category.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

let stream: WriteStream | null | undefined;
let filePath: string | null = null;

/** Opens the log file lazily, so that .env is loaded before it is read. */
function output(): WriteStream | null {
	if (stream !== undefined) return stream;
	const configured = process.env.LOG_FILE ?? "dist/logs.log";
	if (!configured.trim() || /^(off|none|0)$/i.test(configured.trim())) { stream = null; return stream; }
	filePath = resolve(process.cwd(), configured.trim());
	try {
		mkdirSync(dirname(filePath), { recursive: true });
		stream = createWriteStream(filePath, { flags: "a" });
		stream.on("error", (error) => {
			process.stderr.write(`[logger] cannot write ${filePath}: ${error.message}\n`);
			stream = null;
		});
	} catch (error: any) {
		process.stderr.write(`[logger] cannot open ${filePath}: ${error?.message ?? error}\n`);
		stream = null;
	}
	return stream;
}

const consoleEnabled = () => !/^(0|false|off|no)$/i.test((process.env.LOG_CONSOLE ?? "1").trim());

/** Turns the extra arguments of a log call into text: errors with their stack, objects inspected on one line. */
function formatArgs(args: unknown[]): string {
	return args.map((arg) => {
		if (typeof arg === "string") return arg;
		if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
		return inspect(arg, { depth: 4, breakLength: Infinity, compact: true });
	}).join(" ");
}

export class Logger {
	private threshold: number | null = null;

	constructor(readonly category: string) {}

	/** Minimum level of this category, read from the environment on first use. */
	private get minimum(): number {
		if (this.threshold === null) {
			const base = parseLevel(process.env.LOG_LEVEL, RANK[DEFAULT_LEVEL], "LOG_LEVEL");
			this.threshold = parseLevel(process.env[envKey(this.category)], base, envKey(this.category));
		}
		return this.threshold;
	}

	isEnabled(level: LogLevel): boolean {
		return RANK[level] >= this.minimum;
	}

	log(level: LogLevel, message: string, ...args: unknown[]): void {
		if (!this.isEnabled(level)) return;
		const text = args.length ? `${message} ${formatArgs(args)}` : message;
		const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(8)} [${this.category}] ${text}\n`;
		const out = output();
		if (level === "critical" && filePath && out) {
			// The process may stop right after a critical error: write it synchronously so it is not lost.
			try { appendFileSync(filePath, line); } catch { out.write(line); }
		} else {
			out?.write(line);
		}
		if (consoleEnabled()) (RANK[level] >= RANK.warn ? process.stderr : process.stdout).write(line);
	}

	debug(message: string, ...args: unknown[]): void { this.log("debug", message, ...args); }
	info(message: string, ...args: unknown[]): void { this.log("info", message, ...args); }
	warn(message: string, ...args: unknown[]): void { this.log("warn", message, ...args); }
	error(message: string, ...args: unknown[]): void { this.log("error", message, ...args); }
	critical(message: string, ...args: unknown[]): void { this.log("critical", message, ...args); }
}

const loggers = new Map<string, Logger>();

/** One logger per category: getLogger("database"), getLogger("userscript"), ... */
export function getLogger(category: string): Logger {
	let logger = loggers.get(category);
	if (!logger) { logger = new Logger(category); loggers.set(category, logger); }
	return logger;
}

/** Flushes the log file (before exiting). */
export function flushLogs(): Promise<void> {
	return new Promise((done) => {
		const current = stream;
		stream = null;
		if (!current) return done();
		current.end(done);
	});
}
