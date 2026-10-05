import type { ButtonInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { emoji } from "../../config/emoji.js";
import type { BotClient } from "../../core/BotClient.js";
import type { MusicPlayer } from "../../structures/music/index.js";
import { type dangerButton, defContainer, emojiDangerButton, TextDisplay } from "../components.js";
import { checkFairplayModOnly } from "./guard.js";
import { playerButtonId } from "./types.js";

export function buildStopButton(player: MusicPlayer): ReturnType<typeof dangerButton> {
	return emojiDangerButton(playerButtonId("stop"), emoji.get("stop"), !player.hasCurrentTrack);
}

export async function handleStop(
	interaction: ButtonInteraction<"cached">,
	player: MusicPlayer,
	_client: BotClient,
): Promise<void> {
	if (!(await checkFairplayModOnly(interaction, player))) return;

	await player.stop();

	await interaction
		.editReply({
			components: [defContainer().addTextDisplayComponents(TextDisplay("-# Stopped"))],
			flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
		})
		.catch(() => {});
	if (!interaction.channel?.isTextBased()) return;
	await interaction.channel
		.send({
			components: [
				defContainer().addTextDisplayComponents(
					TextDisplay(`-# Stopped, action by <@${interaction.user.id}>`),
				),
			],
			flags: MessageFlags.IsComponentsV2,
		})
		.catch(() => {
			/* empty because errors are intentionally ignored */
		});
}
