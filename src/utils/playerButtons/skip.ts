import type { ButtonInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { emoji } from "../../config/emoji.js";
import type { BotClient } from "../../core/BotClient.js";
import { LoopMode, type MusicPlayer } from "../../structures/music/index.js";
import {
	defContainer,
	emojiSecondaryButton,
	type secondaryButton,
	TextDisplay,
} from "../components.js";
import { sleep } from "../sleep.js";
import { checkFairplayOwnerOrMod, checkVoteRequired } from "./guard.js";
import { playerButtonId } from "./types.js";

export function buildSkipButton(player: MusicPlayer): ReturnType<typeof secondaryButton> {
	return emojiSecondaryButton(playerButtonId("skip"), emoji.get("skip"), !player.hasCurrentTrack);
}

export async function handleSkip(
	interaction: ButtonInteraction<"cached">,
	player: MusicPlayer,
	_client: BotClient,
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
	if (player.getLoop() !== LoopMode.None) {
		await interaction
			.editReply({
				components: [
					defContainer().addTextDisplayComponents(
						TextDisplay("-# Loop mode is on, skipping is disabled."),
					),
				],
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			})
			.catch(() => {});
		return;
	}
	if (!(await checkVoteRequired(interaction))) return;
	if (!(await checkFairplayOwnerOrMod(interaction, player))) return;

	const skipped = player.currentTrack;
	await player.skip(1);

	await interaction
		.editReply({
			components: [
				defContainer().addTextDisplayComponents(
					TextDisplay(skipped ? `-# Skipped **${skipped.info.title}**` : "-# Skipped"),
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
					TextDisplay(`-# Skipped, action by <@${interaction.user.id}>`),
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
