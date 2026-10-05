import { createHmac, randomUUID } from "node:crypto";
import { config } from "../../config/config.js";
import { Middleware } from "../../middlewares/index.js";
import { defineCommand } from "../../types/index.js";

const VOTE_WINDOW_MS = 12 * 60 * 60_000;

export default defineCommand({
	name: "recordvote",
	aliases: ["rv", "testvote"],
	description: "Fire a signed test vote.create event at our own webhook endpoint",
	category: "owner",
	enabledSlash: false,
	middleware: [Middleware.OwnerOnly()],
	async execute(ctx) {
		if (ctx.isSlash()) {
			await ctx.reply({ content: "This command cannot be used as a slash command." });
			return;
		}

		const [targetId, weightArg] = ctx.args;

		if (!targetId) {
			await ctx.reply({ content: "<userId> [weight]" });
			return;
		}

		const weight = weightArg ? Number(weightArg) : 1;
		if (!Number.isInteger(weight) || weight <= 0) {
			await ctx.reply({
				content: "1 or 2",
			});
			return;
		}

		const { webhookSecret } = config.topgg;
		const webhookPort = config.webhookPort;
		if (!webhookSecret) {
			await ctx.reply({ content: "TOPGG_WEBHOOK_SECRET isn't set — can't sign a test payload." });
			return;
		}

		const votedAt = new Date();
		const expiresAt = new Date(votedAt.getTime() + VOTE_WINDOW_MS);

		const body = JSON.stringify({
			type: "vote.create",
			data: {
				id: randomUUID(),
				weight,
				created_at: votedAt.toISOString(),
				expires_at: expiresAt.toISOString(),
				project: {
					id: config.clientId,
					type: "bot",
					platform: "discord",
					platform_id: config.clientId,
				},
				query: {},
				user: {
					id: `manual-${targetId}`,
					platform_id: targetId,
					name: "manual-test",
					avatar_url: "",
				},
			},
		});

		const timestamp = Math.floor(Date.now() / 1000).toString();
		const signature = createHmac("sha256", webhookSecret)
			.update(`${timestamp}.${body}`)
			.digest("hex");

		const url = `http://localhost:${webhookPort}/webhooks/topgg`;

		try {
			const res = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-topgg-signature": `t=${timestamp},v1=${signature}`,
					"x-topgg-trace": `manual-${timestamp}`,
				},
				body,
			});

			const text = await res.text();
			await ctx.reply({
				content: `POST ${url} -> ${res.status}${text ? ` (${text})` : ""}`,
			});
		} catch (err) {
			await ctx.reply({
				content: `Failed to reach webhook server at ${url}: ${(err as Error).message}`,
			});
		}
	},
});
