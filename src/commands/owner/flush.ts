import { getRedis } from "../../db/index.js";
import { Middleware } from "../../middlewares/index.js";
import { defineCommand } from "../../types/command.js";

export default defineCommand({
	name: "flush",
	aliases: ["flushdb", "flushredis"],
	description: "Flush the Redis cache",
	category: "owner",
	enabledSlash: false,
	middleware: [Middleware.OwnerOnly()],
	async execute(ctx) {
		const now = Date.now();
		await getRedis().flushdb();
		const elapsed = Date.now() - now;
		await ctx.reply({
			content: `Flushed in ${elapsed}ms — needs hydration`,
		});
	},
});
