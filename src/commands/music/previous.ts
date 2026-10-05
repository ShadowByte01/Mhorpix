import { MessageFlags } from "discord.js";
import { Middleware } from "../../middlewares/index.js";
import { defineCommand } from "../../types/index.js";
import { defContainer, errorContainer, TextDisplay } from "../../utils/components.js";

export default defineCommand({
	name: "previous",
	aliases: ["prev", "back"],
	description: "Play the previous track",
	category: "music",
	enabledSlash: true,
	slashData: {
		name: "previous",
		description: "Play the previous track",
	},
	middleware: [
		Middleware.Cooldown(8),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.PlayerCheck("playing"),
		Middleware.FairplayBlocked("Previous"),
		Middleware.VoteRequired(),
	],
	async execute(ctx) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player) return;

		if (player.queue.historySize === 0) {
			await ctx.reply({
				components: [errorContainer("No History", "There are no previous tracks in the history.")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const prev = await player.previous();
		if (!prev) {
			await ctx.reply({
				components: [errorContainer("Error", "Could not play the previous track.")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		await ctx.reply({
			components: [
				defContainer().addTextDisplayComponents(
					TextDisplay(`-# Now playing **${prev.info.title}** by **${prev.info.author}**`),
				),
			],
			flags: MessageFlags.IsComponentsV2,
		});
	},
});
