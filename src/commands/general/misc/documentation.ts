import { Middleware } from "../../../middlewares/index.js";
import { defineCommand } from "../../../types/index.js";
import { ActionRow, linkButton } from "../../../utils/components.js";

export default defineCommand({
	name: "documentation",
	aliases: ["docs"],
	description: "link to documentation",
	category: "meta",
	enabledSlash: true,
	slashData: {
		name: "documentation",
		description: "link to documentation",
	},
	middleware: [Middleware.Cooldown(30)],
	async execute(ctx) {
		await ctx.reply({
			components: [
				ActionRow().addComponents(linkButton("documentation", `https://example.com/docs`)),
			],
		});
	},
});
