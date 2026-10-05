import { ComponentType, MessageFlags } from "discord.js";
import { getSpotifyProfile } from "../../db/stores/music.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import type { MusicPlayer, QueueTrack } from "../../structures/music/index.js";
import { ManagerError, PlayerError } from "../../structures/music/index.js";
import { type ResolveQueryResult, resolveQuery } from "../../structures/music/musicSearch.js";
import { defineCommand } from "../../types/index.js";
import {
	ActionRow,
	baseSection,
	defContainer,
	errorContainer,
	primaryButton,
	Separator,
	secondaryButton,
	successContainer,
	TextDisplay,
} from "../../utils/components.js";
import { filterShortTracks, formatMinDurationNotice } from "../../utils/duration.js";
import { logger } from "../../utils/logger.js";
import { fetchSpotifyUser, type SpotifyPlaylistSummary } from "../../utils/spotify.js";
import { unsuppressIfStage } from "../../utils/stage.js";

const PAGE_SIZE = 5;
const COLLECTOR_TIME = 300_000;

async function resolvePlayer(
	ctx: CommandContext,
	voiceChannelId: string,
): Promise<MusicPlayer | null> {
	const music = ctx.client.music;
	const guildId = ctx.guild.id;

	let player = music.getPlayer(guildId);
	try {
		if (!player) {
			player = await music.createPlayer({
				guildId,
				voiceChannelId,
				textChannelId: ctx.channel.id,
				deaf: true,
			});
		} else {
			player.setTextChannel(ctx.channel.id);
		}
		return player;
	} catch (err) {
		if (err instanceof ManagerError && err.code === "PLAYER_EXISTS") {
			const existing = music.getPlayer(guildId);
			if (existing) return existing;
		}
		logger.warn("SpotifyPlaylists", `Failed to create player: ${(err as Error).message}`);
		return null;
	}
}

interface PlayResult {
	readonly ok: boolean;
	readonly message: string;
	readonly trackCount: number;
	readonly removed?: number;
}

async function playPlaylist(
	ctx: CommandContext,
	playlist: SpotifyPlaylistSummary,
): Promise<PlayResult> {
	const voiceChannelId = ctx.member?.voice?.channel?.id;
	if (!voiceChannelId) {
		return { ok: false, message: "You must be in a voice channel to play music.", trackCount: 0 };
	}

	let result: ResolveQueryResult;
	try {
		result = await resolveQuery({ manager: ctx.client.music, query: playlist.url });
	} catch (err) {
		logger.warn("SpotifyPlaylists", `Search failed: ${(err as Error).message}`);
		return { ok: false, message: "Could not reach Lavalink. Try again.", trackCount: 0 };
	}

	if (result.type === "empty") {
		return { ok: false, message: `Nothing found for **${playlist.name}**.`, trackCount: 0 };
	}
	if (result.type === "error") {
		return { ok: false, message: "Unknown Lavalink error.", trackCount: 0 };
	}

	const candidateTracks =
		result.type === "playlist" ? result.tracks : result.tracks[0] ? [result.tracks[0]] : [];
	if (!candidateTracks.length) {
		return { ok: false, message: "Could not load tracks from this playlist.", trackCount: 0 };
	}

	const { kept: rawTracks, removed } = filterShortTracks(candidateTracks);
	if (!rawTracks.length) {
		return {
			ok: false,
			message: "Every track in this playlist is under 45 seconds or a live stream.",
			trackCount: 0,
		};
	}

	const player = await resolvePlayer(ctx, voiceChannelId);
	if (!player) {
		return { ok: false, message: "Could not join your voice channel.", trackCount: 0 };
	}

	const stageResult = await unsuppressIfStage(ctx.guild, voiceChannelId, ctx.client);
	if (!stageResult.ok) {
		return {
			ok: false,
			message: stageResult.reason ?? "I couldn't become a speaker in this Stage channel.",
			trackCount: 0,
		};
	}

	const requester = {
		id: ctx.user.id,
		username: ctx.user.username,
		displayName: ctx.user.displayName,
	};
	const now = Date.now();
	const tracks: QueueTrack[] = rawTracks.map((t) => ({ ...t, requester, addedAt: now }));

	try {
		player.add(tracks);
	} catch (err) {
		if (err instanceof PlayerError && err.code === "QUEUE_FULL") {
			return { ok: false, message: err.message, trackCount: 0 };
		}
		throw err;
	}

	const wasIdle = player.currentTrack === null;
	if (wasIdle) {
		try {
			await player.play();
		} catch (err) {
			logger.error("SpotifyPlaylists", `Playback failed: ${(err as Error).message}`, err as Error);
			return {
				ok: false,
				message: "Could not start playing. The track may be unavailable.",
				trackCount: 0,
			};
		}
	}

	return { ok: true, message: "", trackCount: tracks.length, removed };
}

export default defineCommand({
	name: "spotify-playlists",
	aliases: ["splaylists", "sppl", "spotifyplaylists"],
	description: "Browse and play your Spotify playlists",
	category: "integrations",
	enabledSlash: true,
	slashData: {
		name: "spotify-playlists",
		description: "Browse and play your Spotify playlists",
	},
	middleware: [Middleware.Cooldown(30), Middleware.VoteRequired()],
	async execute(ctx: CommandContext) {
		const spotifyId = await getSpotifyProfile(ctx.user.id);
		if (!spotifyId) {
			await ctx.reply({
				components: [
					errorContainer(
						"No Spotify Linked",
						"Use `/spotify-login` to connect your Spotify profile.",
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		let profile: Awaited<ReturnType<typeof fetchSpotifyUser>>;
		try {
			profile = await fetchSpotifyUser(spotifyId);
		} catch {
			await ctx.reply({
				components: [
					errorContainer("Spotify Error", "Failed to reach Spotify. Try again shortly."),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const playlists: readonly SpotifyPlaylistSummary[] = profile.playlists;

		if (playlists.length === 0) {
			await ctx.reply({
				components: [
					errorContainer("No Playlists", `**${profile.displayName}** has no public playlists.`),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		let page = 0;

		const build = (disable: boolean = false) => {
			const pageCount = Math.max(1, Math.ceil(playlists.length / PAGE_SIZE));
			page = Math.min(page, pageCount - 1);
			const start = page * PAGE_SIZE;
			const pageItems = playlists.slice(start, start + PAGE_SIZE);

			const container = defContainer().addTextDisplayComponents(
				TextDisplay(`### ${profile.displayName}'s Playlists`),
			);
			container.addSeparatorComponents(Separator());

			pageItems.forEach((pl, i) => {
				const globalIndex = start + i;
				const section = baseSection().addTextDisplayComponents(TextDisplay(`**${pl.name}**`));
				section.setButtonAccessory(
					primaryButton("Play", `spotify_pl:play:${globalIndex}`, disable),
				);
				container.addSectionComponents(section);
				if (i < pageItems.length - 1) container.addSeparatorComponents(Separator(false));
			});

			container.addSeparatorComponents(Separator());

			if (pageCount > 1) {
				container.addActionRowComponents(
					ActionRow().addComponents(
						secondaryButton("prev", "spotify_pl:prev", disable || page === 0),
						secondaryButton("next", "spotify_pl:next", disable || page >= pageCount - 1),
					),
				);
			}

			container.addTextDisplayComponents(
				TextDisplay(
					`-# ${playlists.length} playlist${playlists.length !== 1 ? "s" : ""}${pageCount > 1 ? ` • Page ${page + 1}/${pageCount}` : ""}`,
				),
			);

			return container;
		};

		const message = await ctx.reply({ components: [build()], flags: MessageFlags.IsComponentsV2 });

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: COLLECTOR_TIME,
			filter: (i) => i.user.id === ctx.user.id,
		});

		collector.on("collect", async (i) => {
			try {
				if (i.customId === "spotify_pl:prev") {
					await i.deferUpdate();
					page = Math.max(0, page - 1);
					await message.edit({ components: [build()], flags: MessageFlags.IsComponentsV2 });
					return;
				}

				if (i.customId === "spotify_pl:next") {
					await i.deferUpdate();
					page += 1;
					await message.edit({ components: [build()], flags: MessageFlags.IsComponentsV2 });
					return;
				}

				if (i.customId.startsWith("spotify_pl:play:")) {
					await i.deferUpdate();
					const idx = Number(i.customId.slice("spotify_pl:play:".length));
					const playlist = playlists[idx];
					if (!playlist) return;

					const result = await playPlaylist(ctx, playlist);
					await message.edit({
						components: [
							result.ok
								? successContainer().addTextDisplayComponents(
										TextDisplay(
											[
												`### Added to Queue\n\n-# **${playlist.name}** • ${result.trackCount} track${result.trackCount !== 1 ? "s" : ""}`,
												formatMinDurationNotice(result.removed ?? 0),
											]
												.filter(Boolean)
												.join("\n"),
										),
									)
								: errorContainer("Playback Failed", result.message),
						],
						flags: MessageFlags.IsComponentsV2,
					});
				}
			} catch (err) {
				logger.error(
					"SpotifyPlaylists",
					`Collector error: ${(err as Error).message}`,
					err as Error,
				);
			}
		});

		collector.on("end", (_collected, reason) => {
			if (reason === "time") {
				message
					.edit({ components: [build(true)], flags: MessageFlags.IsComponentsV2 })
					.catch(() => undefined);
			}
		});
	},
});
