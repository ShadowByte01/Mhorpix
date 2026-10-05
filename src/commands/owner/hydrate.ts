import { hydrateAll } from "../../db/index.js";
import { Middleware } from "../../middlewares/index.js";
import { defineCommand } from "../../types/command.js";

export default defineCommand({
	name: "hydrate",
	aliases: ["hyd"],
	description: "Hydrate the database",
	category: "owner",
	enabledSlash: false,
	middleware: [Middleware.OwnerOnly()],
	async execute(ctx) {
		const now = Date.now();
		await hydrateAll();
		const elapsed = Date.now() - now;
		await ctx.reply({
			content: `Hydrated in ${elapsed}ms`,
		});
	},
});
