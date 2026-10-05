import type { CommandContext } from "../structures/context/index.js";
import type { Command } from "./command.js";

export interface MiddlewareError {
	title: string;
	description: string;
}

export type MiddlewareResult =
	| { ok: true }
	| { ok: false; error: MiddlewareError; silent?: boolean };

export type MiddlewareCheck = (
	ctx: CommandContext,
	command: Command,
) => MiddlewareResult | Promise<MiddlewareResult>;

export type MiddlewareFn = MiddlewareCheck & { label?: string };

export function ok(): MiddlewareResult {
	return { ok: true };
}

export function fail(
	title: string,
	description: string,
	options: { silent?: boolean } = {},
): MiddlewareResult {
	const { silent = false } = options;
	return { ok: false, error: { title, description }, silent };
}

export function withLabel(label: string, check: MiddlewareCheck): MiddlewareFn {
	const fn = check as MiddlewareFn;
	fn.label = label;
	return fn;
}
