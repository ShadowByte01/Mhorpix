import { config } from "../../../config/config.js";
import { Middleware } from "../../../middlewares/index.js";
import { defineCommand } from "../../../types/index.js";
import { ActionRow, linkButton } from "../../../utils/components.js";

export default defineCommand({
	name: "invite",
	aliases: ["botinvite"],
	description: "link to invite the bot",
	category: "meta",
	enabledSlash: true,
	slashData: {
		name: "invite",
		description: "link to invite the bot",
	},
	middleware: [Middleware.Cooldown(30)],
	async execute(ctx) {
		await ctx.reply({
			components: [
				ActionRow().addComponents(
					linkButton("invite", `https://discord.com/oauth2/authorize?client_id=${config.clientId}`),
				),
			],
		});
	},
});
