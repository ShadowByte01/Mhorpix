import { MessageFlags } from "discord.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import { defineCommand, type MusicPlayer } from "../../types/index.js";
import { defContainer, errorContainer, TextDisplay } from "../../utils/components.js";

async function shuffleCheck(ctx: CommandContext, player: MusicPlayer) {
	if (player.queue.size <= 4) {
		await ctx.reply({
			components: [
				errorContainer(
					"Not Enough Songs",
					"There are not enough songs in the queue to shuffle. Please add more songs(minimum 4) to the queue.",
				),
			],
			flags: MessageFlags.IsComponentsV2,
		});
		return;
	}
}
export default defineCommand({
	name: "shuffle",
	aliases: ["shuf"],
	description: "Shuffle the current queue",
	category: "music",
	enabledSlash: true,
	slashData: {
		name: "shuffle",
		description: "Shuffle the current queue",
	},
	middleware: [
		Middleware.Cooldown(10),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.PlayerCheck("playing"),
		Middleware.FairplayBlocked("Shuffle"),
	],
	async execute(ctx) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player) return;
		await shuffleCheck(ctx, player);

		player.shuffle();
		await ctx.reply({
			components: [
				defContainer().addTextDisplayComponents(
					TextDisplay(`-# Shuffled  \`${player.queue.size}\` songs in the queue.`),
				),
			],
			flags: MessageFlags.IsComponentsV2,
		});
	},
});
