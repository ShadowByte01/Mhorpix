import { type ButtonInteraction, MessageFlags, type ModalSubmitInteraction } from "discord.js";
import type { BotClient } from "../../core/BotClient.js";
import type { MusicPlayer } from "../../structures/music/index.js";
import { errorContainer } from "../components.js";
import { logger } from "../logger.js";
import { checkButtonCooldown } from "./cooldown.js";
import { replyError, resolvePlayerAndVoice } from "./guard.js";
import { handlePlayPause } from "./playPause.js";
import { handleSettingsButton, handleSettingsModalSubmit } from "./settings.js";
import { handleSkip } from "./skip.js";
import { handleStop } from "./stop.js";
import { type PlayerButtonAction, parsePlayerButtonId } from "./types.js";

export { buildPlayerControlsRow } from "./row.js";
export { isPlayerSettingsModalId, PLAYER_BUTTON_PREFIX, parsePlayerButtonId } from "./types.js";

type ButtonHandler = (
	interaction: ButtonInteraction<"cached">,
	player: MusicPlayer,
	client: BotClient,
) => Promise<void>;

const HANDLERS: Readonly<Record<Exclude<PlayerButtonAction, "settings">, ButtonHandler>> = {
	playpause: handlePlayPause,
	skip: handleSkip,
	stop: handleStop,
};

export function isPlayerButtonInteraction(customId: string): boolean {
	return parsePlayerButtonId(customId) !== null;
}

export async function handlePlayerButtonInteraction(
	interaction: ButtonInteraction,
	client: BotClient,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;

	const action = parsePlayerButtonId(interaction.customId);
	if (!action) return;

	if (action === "settings") {
		const player = client.music.getPlayer(interaction.guildId);
		if (!player) {
			await interaction
				.reply({
					components: [errorContainer("No Player", "No player found for this server.")],
					flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				})
				.catch(() => {});
			return;
		}

		const voiceChannelId = interaction.member.voice.channelId;
		if (!voiceChannelId || voiceChannelId !== player.voiceChannelId) {
			await interaction
				.reply({
					components: [
						errorContainer(
							"Wrong Voice Channel",
							"You need to be in the same voice channel as the bot to do this.",
						),
					],
					flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				})
				.catch(() => {});
			return;
		}

		try {
			await handleSettingsButton(interaction, player);
		} catch (err) {
			logger.error("PlayerButtons", `Failed to open settings modal: ${(err as Error).message}`);
			await interaction
				.reply({
					components: [errorContainer("Error", "Something went wrong opening settings.")],
					flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				})
				.catch(() => {});
		}
		return;
	}

	const remaining = await checkButtonCooldown(interaction.guildId, interaction.user.id, action);
	if (remaining > 0) {
		const timestamp = Math.floor((Date.now() + remaining * 1_000) / 1_000);
		await interaction
			.reply({
				components: [errorContainer("Cooldown", `You can use this again <t:${timestamp}:R>.`)],
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			})
			.catch(() => {});
		return;
	}

	await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

	const player = await resolvePlayerAndVoice(interaction, client);
	if (!player) return;

	try {
		await HANDLERS[action](interaction, player, client);
	} catch (err) {
		logger.error("PlayerButtons", `Failed to handle "${action}" button: ${(err as Error).message}`);
		await replyError(interaction, "Error", "Something went wrong handling that button.");
	}
}

export async function handlePlayerSettingsModalSubmit(
	interaction: ModalSubmitInteraction,
	client: BotClient,
): Promise<void> {
	if (!interaction.inCachedGuild()) return;

	try {
		await handleSettingsModalSubmit(interaction, client);
	} catch (err) {
		logger.error(
			"PlayerButtons",
			`Failed to handle settings modal submit: ${(err as Error).message}`,
		);
		await interaction
			.reply({
				components: [errorContainer("Error", "Something went wrong applying those settings.")],
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			})
			.catch(() => {});
	}
}
