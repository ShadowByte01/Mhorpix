import { Middleware } from "../../../middlewares/index.js";
import { defineCommand } from "../../../types/index.js";
import { ActionRow, linkButton } from "../../../utils/components.js";

export default defineCommand({
	name: "github",
	aliases: ["gh"],
	description: "link to github repository",
	category: "meta",
	enabledSlash: true,
	slashData: {
		name: "github",
		description: "link to github repository",
	},
	middleware: [Middleware.Cooldown(30)],
	async execute(ctx) {
		await ctx.reply({
			components: [ActionRow().addComponents(linkButton("github", `https://github.com/`))],
		});
	},
});
