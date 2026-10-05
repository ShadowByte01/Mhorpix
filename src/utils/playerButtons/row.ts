import type { ActionRowBuilder, MessageActionRowComponentBuilder } from "discord.js";
import type { MusicPlayer } from "../../structures/music/index.js";
import { ActionRow } from "../components.js";
import { buildPlayPauseButton } from "./playPause.js";
import { buildSettingsButton } from "./settings.js";
import { buildSkipButton } from "./skip.js";
import { buildStopButton } from "./stop.js";

export function buildPlayerControlsRow(
	player: MusicPlayer,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
	return ActionRow().addComponents(
		buildPlayPauseButton(player),
		buildSkipButton(player),
		buildStopButton(player),
		buildSettingsButton(player),
	);
}
