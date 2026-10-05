import { MessageFlags } from "discord.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import { defineCommand, type MusicPlayer } from "../../types/index.js";
import { defContainer, errorContainer, TextDisplay } from "../../utils/components.js";

async function checkQueue(ctx: CommandContext, player: MusicPlayer) {
	if (player.queue.isEmpty) {
		await ctx.reply({
			components: [errorContainer("Already Paused", "The queue is already empty.")],
			flags: MessageFlags.IsComponentsV2,
		});
		return false;
	}
	return true;
}

export default defineCommand({
	name: "clearqueue",
	aliases: ["cq"],
	description: "Clears the queue",
	category: "music",
	enabledSlash: true,
	slashData: {
		name: "clearqueue",
		description: "Clears the queue",
	},
	middleware: [
		Middleware.Cooldown(15),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.PlayerCheck("playing"),
		Middleware.FairplayModOnly(),
	],
	async execute(ctx) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player) return;
		const proceed = await checkQueue(ctx, player);
		if (!proceed) return;
		const total = player.queue.size;
		player.clearQueue();
		await ctx.reply({
			components: [
				defContainer().addTextDisplayComponents(
					TextDisplay(`-# Removed ${total} tracks from the queue.`),
				),
			],
			flags: MessageFlags.IsComponentsV2,
		});
	},
});
