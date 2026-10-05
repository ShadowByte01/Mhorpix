import { config } from "../../../config/config.js";
import { Middleware } from "../../../middlewares/index.js";
import { defineCommand } from "../../../types/index.js";
import { ActionRow, linkButton } from "../../../utils/components.js";

export default defineCommand({
	name: "support",
	aliases: ["supportserver"],
	description: "link to support server",
	category: "meta",
	enabledSlash: true,
	slashData: {
		name: "support",
		description: "link to support server",
	},
	middleware: [Middleware.Cooldown(30)],
	async execute(ctx) {
		await ctx.reply({
			components: [ActionRow().addComponents(linkButton("support", config.supportLink))],
		});
	},
});
