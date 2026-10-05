import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { ComponentType, MessageFlags } from "discord.js";
import { emoji } from "../../config/emoji.js";
import type { BotClient } from "../../core/BotClient.js";
import {
	addFavourite,
	getFavouriteCount,
	getFavouritesLimit,
	isFavourited,
	removeFavourite,
} from "../../db/stores/music.js";
import { addTrack, getUserPlaylists } from "../../db/stores/playlists.js";
import type { MusicPlayer } from "../../structures/music/index.js";
import { LoopMode } from "../../types/index.js";
import {
	Checkbox,
	defContainer,
	emojiSecondaryButton,
	errorContainer,
	Label,
	Modal,
	ModalSelectMenu,
	RadioGroup,
	type secondaryButton,
	TextDisplay,
	TextInput,
} from "../components.js";
import { logger } from "../logger.js";
import { updateNowPlaying } from "../playerMessages.js";
import { checkButtonCooldown } from "./cooldown.js";
import { hasActiveVoteOrPremium, isFairplayModMember } from "./guard.js";
import {
	PLAYER_SETTINGS_MODAL_ID,
	playerButtonId,
	SETTINGS_AUTOPLAY_FIELD,
	SETTINGS_FAIRPLAY_FIELD,
	SETTINGS_FAVOURITE_FIELD,
	SETTINGS_LOOP_FIELD,
	SETTINGS_PLAYLIST_FIELD,
	SETTINGS_VOLUME_FIELD,
} from "./types.js";

const MIN_VOLUME = 0;
const MAX_VOLUME = 150;
const PLAYLIST_OPTIONS_LIMIT = 25;

const LOOP_OPTIONS: { mode: LoopMode; label: string }[] = [
	{ mode: LoopMode.None, label: "None" },
	{ mode: LoopMode.Track, label: "Track" },
	{ mode: LoopMode.Queue, label: "Queue" },
];
const LOOP_VALUES: readonly LoopMode[] = LOOP_OPTIONS.map((o) => o.mode);

async function replyBlocked(
	interaction: ButtonInteraction<"cached">,
	title: string,
	description: string,
): Promise<void> {
	await interaction
		.reply({
			components: [errorContainer(title, description)],
			flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
		})
		.catch(() => {});
}

async function editReplyBlocked(
	interaction: ModalSubmitInteraction<"cached">,
	title: string,
	description: string,
): Promise<void> {
	await interaction
		.editReply({
			components: [errorContainer(title, description)],
		})
		.catch(() => {});
}

async function timed<T>(_label: string, promise: Promise<T>): Promise<T> {
	//const start = performance.now();
	try {
		return await promise;
	} finally {
		//	const ms = Math.round(performance.now() - start);
		//logger.warn("PlayerSettingsTiming", `${label}: ${ms}ms`);
		// NOTE: for future debugging
	}
}

export function buildSettingsButton(player: MusicPlayer): ReturnType<typeof secondaryButton> {
	return emojiSecondaryButton(
		playerButtonId("settings"),
		emoji.get("more"),
		!player.hasCurrentTrack,
	);
}

export async function handleSettingsButton(
	interaction: ButtonInteraction<"cached">,
	player: MusicPlayer,
): Promise<void> {
	const track = player.currentTrack;
	if (!player.hasCurrentTrack || !track) {
		await replyBlocked(interaction, "Nothing Playing", "There is no song currently playing.");
		return;
	}

	const favouriteAllowed = !track.info.isStream;
	const batchStart = performance.now();
	const [remainingCooldown, voteOrPremium, playlists, modAllowed, alreadyFavourited] =
		await Promise.all([
			timed(
				"checkButtonCooldown",
				checkButtonCooldown(interaction.guildId, interaction.user.id, "settings"),
			),
			timed(
				"hasActiveVoteOrPremium",
				hasActiveVoteOrPremium(interaction.guildId, interaction.user.id),
			),
			timed("getUserPlaylists", getUserPlaylists(interaction.user.id)),
			timed("isFairplayModMember", isFairplayModMember(interaction.guildId, interaction.member)),
			timed(
				"isFavourited",
				favouriteAllowed
					? isFavourited(interaction.user.id, track.encoded)
					: Promise.resolve(false),
			),
		]);
	logger.warn(
		"PlayerSettingsTiming",
		`batch total: ${Math.round(performance.now() - batchStart)}ms`,
	);

	if (remainingCooldown > 0) {
		const timestamp = Math.floor((Date.now() + remainingCooldown * 1_000) / 1_000);
		await replyBlocked(interaction, "Cooldown", `You can use this again <t:${timestamp}:R>.`);
		return;
	}

	if (!voteOrPremium) {
		await replyBlocked(
			interaction,
			"Vote Required",
			"This action requires an active vote. Vote on Top.gg and try again - \n https://top.gg/",
		);
		return;
	}

	const fairplayActive = player.isFairplay();
	const volumeAllowed = !fairplayActive || modAllowed;
	const loopAllowed = !fairplayActive;
	const playlistAllowed = playlists.length > 0;

	if (
		fairplayActive &&
		!volumeAllowed &&
		!loopAllowed &&
		!favouriteAllowed &&
		!playlistAllowed &&
		!modAllowed
	) {
		await replyBlocked(
			interaction,
			"Not Allowed",
			"Fairplay mode is on — loop is fully disabled while it's active, and volume needs Mute Members or the Fairplay Mod role. There's also nothing else here right now (live stream, no playlists).",
		);
		return;
	}

	const labels: ReturnType<typeof Label>[] = [];

	if (volumeAllowed) {
		labels.push(
			Label(
				"Volume",
				TextInput(SETTINGS_VOLUME_FIELD)
					.setPlaceholder(`${MIN_VOLUME}-${MAX_VOLUME}`)
					.setValue(String(player.volume))
					.setMinLength(1)
					.setMaxLength(3)
					.setRequired(true),
				`Whole number between ${MIN_VOLUME} and ${MAX_VOLUME}`,
			),
		);
	}

	if (loopAllowed) {
		const currentLoop = player.getLoop();
		labels.push(
			Label(
				"Loop Mode",
				RadioGroup(
					SETTINGS_LOOP_FIELD,
					LOOP_OPTIONS.map((o) => ({
						label: o.label,
						value: o.mode,
						default: o.mode === currentLoop,
					})),
					true,
				),
			),
		);
	}

	if (modAllowed && labels.length < 5) {
		labels.push(
			Label(
				"Fairplay Mode",
				Checkbox(SETTINGS_FAIRPLAY_FIELD, fairplayActive),
				"Rotates the queue fairly and locks skip/seek/remove to the requester or a mod",
			),
		);
	}

	if (labels.length < 5) {
		labels.push(
			Label(
				"Autoplay",
				Checkbox(SETTINGS_AUTOPLAY_FIELD, player.getAutoplay()),
				"Automatically queues similar tracks when the queue runs low",
			),
		);
	}

	if (favouriteAllowed && labels.length < 5) {
		labels.push(
			Label(
				"Favourite",
				Checkbox(SETTINGS_FAVOURITE_FIELD, alreadyFavourited),
				alreadyFavourited
					? "Already in your favourites — uncheck to remove"
					: "Check to add this track to your favourites",
			),
		);
	}

	if (playlistAllowed && labels.length < 5) {
		const options = playlists.slice(0, PLAYLIST_OPTIONS_LIMIT).map((p) => ({
			label: p.name.slice(0, 100),
			value: p.id,
			description: `${p.trackCount} tracks`,
		}));
		labels.push(
			Label(
				"Add to Playlist",
				ModalSelectMenu("Choose a playlist", options, SETTINGS_PLAYLIST_FIELD, 0, 1, false),
				"Adds the current track only — leave blank to skip",
			),
		);
	}

	const modal = Modal(PLAYER_SETTINGS_MODAL_ID, "Player Settings").addLabelComponents(...labels);

	await interaction.showModal(modal).catch((err) => {
		logger.error("PlayerSettings", `showModal failed: ${err.message}`);
	});
}

export async function handleSettingsModalSubmit(
	interaction: ModalSubmitInteraction<"cached">,
	client: BotClient,
): Promise<void> {
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

	await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

	const [voteOrPremium, modAllowed] = await Promise.all([
		hasActiveVoteOrPremium(interaction.guildId, interaction.user.id),
		isFairplayModMember(interaction.guildId, interaction.member),
	]);

	if (!voteOrPremium) {
		await editReplyBlocked(
			interaction,
			"Vote Required",
			"This action requires an active vote. Vote on Top.gg and try again - \n https://top.gg/",
		);
		return;
	}

	const changes: string[] = [];
	const publicChanges: string[] = [];

	try {
		const rawVolume = interaction.fields.getTextInputValue(SETTINGS_VOLUME_FIELD).trim();
		const volume = Number.parseInt(rawVolume, 10);
		if (!Number.isInteger(volume) || volume < MIN_VOLUME || volume > MAX_VOLUME) {
			await editReplyBlocked(
				interaction,
				"Invalid Volume",
				`Volume must be a whole number between ${MIN_VOLUME} and ${MAX_VOLUME}.`,
			);
			return;
		}
		if (volume !== player.volume) {
			await player.setVolume(volume);
			changes.push(`volume set to \`${volume}%\``);
			publicChanges.push(`volume set to \`${volume}%\``);
		}
	} catch {
		// Volume field not present
	}

	try {
		const loopField = interaction.fields.getField(SETTINGS_LOOP_FIELD, ComponentType.RadioGroup);
		const loopValue = loopField.value as LoopMode | null;
		if (loopValue && LOOP_VALUES.includes(loopValue) && loopValue !== player.getLoop()) {
			try {
				player.setLoop(loopValue);
				changes.push(`loop set to \`${loopValue}\``);
				publicChanges.push(`loop set to \`${loopValue}\``);
			} catch (err) {
				logger.error("PlayerSettings", `setLoop failed: ${(err as Error).message}`);
			}
		}
	} catch {
		// Loop field not present
	}

	if (modAllowed) {
		try {
			const fairplayChecked = interaction.fields.getField(
				SETTINGS_FAIRPLAY_FIELD,
				ComponentType.Checkbox,
			).value;
			if (fairplayChecked !== player.isFairplay()) {
				try {
					player.setFairplay(fairplayChecked);
					changes.push(`fairplay mode ${fairplayChecked ? "enabled" : "disabled"}`);
					publicChanges.push(`fairplay mode ${fairplayChecked ? "enabled" : "disabled"}`);
				} catch (err) {
					logger.error(
						"PlayerSettings",
						`setFairplay(${fairplayChecked}) failed: ${(err as Error).message}`,
					);
				}
			}
		} catch {
			// Fairplay field not present
		}
	}

	try {
		const autoplayChecked = interaction.fields.getField(
			SETTINGS_AUTOPLAY_FIELD,
			ComponentType.Checkbox,
		).value;
		if (autoplayChecked !== player.getAutoplay()) {
			try {
				player.setAutoplay(autoplayChecked);
				changes.push(`autoplay ${autoplayChecked ? "enabled" : "disabled"}`);
				publicChanges.push(`autoplay ${autoplayChecked ? "enabled" : "disabled"}`);
			} catch (err) {
				logger.error(
					"PlayerSettings",
					`setAutoplay(${autoplayChecked}) failed: ${(err as Error).message}`,
				);
			}
		}
	} catch {
		// Autoplay field not present
	}

	const track = player.currentTrack;
	if (track && !track.info.isStream) {
		try {
			const checked = interaction.fields.getField(
				SETTINGS_FAVOURITE_FIELD,
				ComponentType.Checkbox,
			).value;
			const wasFavourited = await isFavourited(interaction.user.id, track.encoded);
			if (checked && !wasFavourited) {
				const [limit, count] = await Promise.all([
					getFavouritesLimit(interaction.user.id),
					getFavouriteCount(interaction.user.id),
				]);
				if (count >= limit) {
					await editReplyBlocked(
						interaction,
						"Limit Reached",
						`Maximum of **${limit}** favourites. Remove some before adding more.`,
					);
					return;
				}
				const result = await addFavourite(interaction.user.id, track.encoded);
				if (result.ok) changes.push("added to favourites");
			} else if (!checked && wasFavourited) {
				const removed = await removeFavourite(interaction.user.id, track.encoded);
				if (removed) changes.push("removed from favourites");
			}
		} catch {
			// Favourite field not present
		}
	}

	if (track) {
		try {
			const selectedId = interaction.fields.getStringSelectValues(SETTINGS_PLAYLIST_FIELD)[0];
			if (selectedId) {
				const playlists = await getUserPlaylists(interaction.user.id);
				const target = playlists.find((p) => p.id === selectedId);
				if (target) {
					const result = await addTrack(target.id, interaction.user.id, track.encoded);
					if (result.success) changes.push(`added to playlist **${target.name}**`);
				}
			}
		} catch {
			// Playlist field not present
		}
	}

	if (changes.length === 0) {
		await interaction
			.editReply({
				components: [defContainer().addTextDisplayComponents(TextDisplay("-# No changes made."))],
				flags: MessageFlags.IsComponentsV2,
			})
			.catch(() => {});
		return;
	}

	const summary = changes.join(", ");
	await updateNowPlaying(player, client);

	await interaction
		.editReply({
			components: [defContainer().addTextDisplayComponents(TextDisplay(`-# ${summary}.`))],
			flags: MessageFlags.IsComponentsV2,
		})
		.catch(() => {});

	if (publicChanges.length === 0) return;
	if (!interaction.channel?.isTextBased()) return;

	const publicSummary = publicChanges.join(", ");
	await interaction.channel
		.send({
			components: [
				defContainer().addTextDisplayComponents(
					TextDisplay(
						`-# Settings updated (${publicSummary}), action by <@${interaction.user.id}>`,
					),
				),
			],
			flags: MessageFlags.IsComponentsV2,
		})
		.catch(() => {});
}
