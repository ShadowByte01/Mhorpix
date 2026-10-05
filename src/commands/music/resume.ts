import { MessageFlags } from "discord.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import { defineCommand, type MusicPlayer } from "../../types/index.js";
import { defContainer, errorContainer, TextDisplay } from "../../utils/components.js";

async function checkPause(ctx: CommandContext, player: MusicPlayer) {
	if (!player.paused) {
		await ctx.reply({
			components: [errorContainer("Not Paused", "The player not paused.")],
			flags: MessageFlags.IsComponentsV2,
		});
		return false;
	}
	return true;
}

export default defineCommand({
	name: "resume",
	aliases: ["baja"],
	description: "resumes the player",
	category: "music",
	enabledSlash: true,
	slashData: {
		name: "resume",
		description: "resumes the player",
	},
	middleware: [
		Middleware.Cooldown(7),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.PlayerCheck("playing"),
		Middleware.FairplayModOnly(),
	],
	async execute(ctx) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player) return;
		const proceed = await checkPause(ctx, player);
		if (!proceed) return;
		await player.setPaused(false);
		await ctx.reply({
			components: [
				defContainer().addTextDisplayComponents(
					TextDisplay(`-# Started Playing **${player.currentTrack?.info.title}**`),
				),
			],
			flags: MessageFlags.IsComponentsV2,
		});
	},
});
