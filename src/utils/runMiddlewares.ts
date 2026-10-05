import type { CommandContext } from "../structures/context/index.js";
import type { Command } from "../types/command.js";
import { type MiddlewareResult, ok } from "../types/middleware.js";

export async function runMiddlewares(
	ctx: CommandContext,
	command: Command,
): Promise<MiddlewareResult> {
	if (!command.middleware?.length) return ok();

	for (const middleware of command.middleware) {
		// biome-ignore lint/performance/noAwaitInLoops: middlewares must run sequentially; each result gates the next
		const result = await middleware(ctx, command);
		if (!result.ok) return result;
	}

	return ok();
}
