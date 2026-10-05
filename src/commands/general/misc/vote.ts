import { Middleware } from "../../../middlewares/index.js";
import { defineCommand } from "../../../types/index.js";
import { ActionRow, linkButton } from "../../../utils/components.js";

export default defineCommand({
	name: "vote",
	aliases: ["votelink"],
	description: "link to vote for the bot",
	category: "meta",
	enabledSlash: true,
	slashData: {
		name: "vote",
		description: "link to vote for the bot",
	},
	middleware: [Middleware.Cooldown(30)],
	async execute(ctx) {
		await ctx.reply({
			components: [
				ActionRow().addComponents(
					linkButton("vote for the bot", "https://top.gg/"),
				),
			],
		});
	},
});
