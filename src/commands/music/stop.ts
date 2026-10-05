import { MessageFlags } from "discord.js";
import { Middleware } from "../../middlewares/index.js";
import { defineCommand } from "../../types/index.js";
import { defContainer, TextDisplay } from "../../utils/components.js";

export default defineCommand({
	name: "stop",
	description: "Stop the current track",
	category: "music",
	enabledSlash: true,
	slashData: {
		name: "stop",
		description: "Stop the current track",
	},
	middleware: [
		Middleware.Cooldown(20),
		Middleware.GuildOnly(),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.PlayerCheck("playing"),
		Middleware.FairplayModOnly(),
	],
	async execute(ctx) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player) return;

		await player.stop();

		await ctx.reply({
			components: [defContainer().addTextDisplayComponents(TextDisplay("> Stopped"))],
			flags: MessageFlags.IsComponentsV2,
		});
	},
});
