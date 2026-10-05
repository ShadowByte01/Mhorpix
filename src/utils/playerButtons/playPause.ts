import type { ButtonInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { emoji } from "../../config/emoji.js";
import type { BotClient } from "../../core/BotClient.js";
import type { MusicPlayer } from "../../structures/music/index.js";
import {
	defContainer,
	emojiSecondaryButton,
	type secondaryButton,
	TextDisplay,
} from "../components.js";
import { updateNowPlaying } from "../playerMessages.js";
import { sleep } from "../sleep.js";
import { checkFairplayModOnly } from "./guard.js";
import { playerButtonId } from "./types.js";

export function buildPlayPauseButton(player: MusicPlayer): ReturnType<typeof secondaryButton> {
	return emojiSecondaryButton(
		playerButtonId("playpause"),
		player.paused ? emoji.get("resume") : emoji.get("pause"),
		!player.hasCurrentTrack,
	);
}

export async function handlePlayPause(
	interaction: ButtonInteraction<"cached">,
	player: MusicPlayer,
	client: BotClient,
): Promise<void> {
	if (!player.hasCurrentTrack) {
		await interaction
			.editReply({
				components: [
					defContainer().addTextDisplayComponents(TextDisplay("-# No song is currently playing.")),
				],
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			})
			.catch(() => {});
		return;
	}

	if (!(await checkFairplayModOnly(interaction, player))) return;

	const wasPaused = player.paused;
	await player.setPaused(!wasPaused);
	await updateNowPlaying(player, client);

	await interaction
		.editReply({
			components: [
				defContainer().addTextDisplayComponents(
					TextDisplay(
						wasPaused
							? `-# Started Playing **${player.currentTrack?.info.title}**`
							: `-# Paused playing **${player.currentTrack?.info.title}**`,
					),
				),
			],
			flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
		})
		.catch(() => {});
	if (!interaction.channel?.isTextBased()) return;
	const message = await interaction.channel
		.send({
			components: [
				defContainer().addTextDisplayComponents(
					TextDisplay(
						wasPaused
							? `-# Resumed playing , action by <@${interaction.user.id}>`
							: `-# Paused playing , action by <@${interaction.user.id}>`,
					),
				),
			],
			flags: MessageFlags.IsComponentsV2,
		})
		.catch(() => {
			/* empty because errors are intentionally ignored */
		});
	await sleep(5_000);
	if (message)
		await message.delete().catch(() => {
			/* empty because errors are intentionally ignored */
		});
}
