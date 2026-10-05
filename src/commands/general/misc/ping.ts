import { getRedis } from "../../../db/redis.js";
import { Middleware } from "../../../middlewares/index.js";
import { defineCommand } from "../../../types/index.js";

export default defineCommand({
	name: "ping",
	aliases: ["latency", "pong"],
	description: "Check the bot latency",
	category: "meta",
	enabledSlash: true,
	slashData: {
		name: "ping",
		description: "Check the bot latency",
	},
	middleware: [Middleware.Cooldown(30)],
	async execute(ctx) {
		const start = Date.now();
		await ctx.reply({ content: "Pinging..." });
		const botLatency = Date.now() - start;

		const redis = getRedis();

		const redisStart = Date.now();
		await redis.ping();
		const redisLatency = Date.now() - redisStart;

		await ctx.editReply({
			content: [`>>> **Bot Latency**: ${botLatency}ms`, `**Redis**: ${redisLatency}ms `].join("\n"),
		});
	},
});
