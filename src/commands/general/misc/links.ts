import { config } from "../../../config/config.js";
import { Middleware } from "../../../middlewares/index.js";
import { defineCommand } from "../../../types/index.js";
import { ActionRow, linkButton } from "../../../utils/components.js";

export default defineCommand({
	name: "links",
	description: "various links associated with the bot",
	category: "meta",
	enabledSlash: true,
	slashData: {
		name: "links",
		description: "various links associated with the bot",
	},
	middleware: [Middleware.Cooldown(30)],
	async execute(ctx) {
		await ctx.reply({
			components: [
				ActionRow().addComponents(
					linkButton("documentation", `https://example.com/docs`),
					linkButton("invite", `https://discord.com/oauth2/authorize?client_id=${config.clientId}`),
					linkButton("vote for the bot", "https://top.gg/"),
					linkButton("support server", config.supportLink),
				),
				ActionRow().addComponents(
					linkButton("Privacy Policy", "https://example.com/privacy"),
					linkButton("Terms of Service", "https://example.com/terms"),
					linkButton("Copyright", "https://example.com/copyright"),
				),
			],
		});
	},
});
