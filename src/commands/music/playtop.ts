import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { ensureGuild } from "../../db/stores/guild.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import type { MusicPlayer, QueueTrack } from "../../structures/music/index.js";
import { ManagerError, PlayerError } from "../../structures/music/index.js";
import { type ResolveQueryResult, resolveQuery } from "../../structures/music/musicSearch.js";
import { defineCommand } from "../../types/index.js";
import {
	baseSection,
	dangerButton,
	defContainer,
	errorContainer,
	Separator,
	TextDisplay,
} from "../../utils/components.js";
import { filterShortTracks, formatMinDurationNotice } from "../../utils/duration.js";
import { logger } from "../../utils/logger.js";
import { unsuppressIfStage } from "../../utils/stage.js";

async function handleResult(
	ctx: CommandContext,
	result: ResolveQueryResult,
	tracks: QueueTrack[],
	player: MusicPlayer,
	wasIdle: boolean,
	removed = 0,
): Promise<void> {
	switch (result.type) {
		case "playlist": {
			const container = defContainer().addTextDisplayComponents(
				TextDisplay(
					[
						`**Playlist queued** — \`${result.playlistName ?? "Unknown playlist"}\``,
						`Added **${tracks.length}** tracks to the top of the queue`,
						wasIdle ? "Started playing now" : null,
						formatMinDurationNotice(removed),
					]
						.filter(Boolean)
						.join("\n"),
				),
			);
			await ctx.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
			return;
		}

		case "track": {
			const track = tracks[0];
			if (!track) return;
			const { title, uri, author } = track.info;
			const queueSize = player.queue.size;

			const container = defContainer()
				.addTextDisplayComponents(TextDisplay(wasIdle ? " Now Playing" : "Added to the top Queue"))
				.addSeparatorComponents(Separator())
				.addSectionComponents(
					baseSection()
						.addTextDisplayComponents(
							TextDisplay(
								[
									`**[${title}](${uri})**`,
									author,
									queueSize ? `-# **Up Next:** \`#${queueSize}\`` : null,
								]
									.filter(Boolean)
									.join("\n"),
							),
						)
						.setButtonAccessory(
							dangerButton(
								"Remove",
								`playRemove:${track.encoded.slice(20, 100)}`,
								wasIdle === true,
							),
						),
				);
			await ctx.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
			return;
		}
	}
}

async function fetchSearchResult(ctx: CommandContext, query: string) {
	try {
		const result = await resolveQuery({
			manager: ctx.client.music,
			query,
		});

		switch (result.type) {
			case "empty":
				await ctx.reply({
					components: [errorContainer("No Results", `Nothing found for **${query}**`)],
					flags: MessageFlags.IsComponentsV2,
				});
				return null;
			case "error":
				await ctx.reply({
					components: [errorContainer("Search Error", "Unknown Lavalink error")],
					flags: MessageFlags.IsComponentsV2,
				});
				return null;
			default:
				return result;
		}
	} catch (err) {
		logger.warn("Play", `Search failed: ${(err as Error).message}`);
		await ctx.reply({
			components: [errorContainer("Search Failed", "Could not reach Lavalink. Try again.")],
			flags: MessageFlags.IsComponentsV2,
		});
		return null;
	}
}

async function resolvePlayer(
	ctx: CommandContext,
	voiceChannelId: string,
): Promise<MusicPlayer | null> {
	const music = ctx.client.music;
	const guildId = ctx.guild.id;

	let player = music.getPlayer(guildId);
	try {
		if (!player) {
			const guildSettings = await ensureGuild(guildId);

			player = await music.createPlayer({
				guildId,
				voiceChannelId,
				textChannelId: ctx.channel.id,
				deaf: true,
				volume: guildSettings.defaultVolume,
			});
			if (guildSettings.fairplayDefault) player.setFairplay(true);
		} else {
			player.setTextChannel(ctx.channel.id);
		}
		return player;
	} catch (err) {
		if (err instanceof ManagerError && err.code === "PLAYER_EXISTS") {
			const existing = music.getPlayer(guildId);
			if (existing) return existing;
		}

		logger.warn("Play", `Failed to create player: ${(err as Error).message}`);
		await ctx.reply({
			components: [errorContainer("Connection Failed", "Could not join your voice channel.")],
			flags: MessageFlags.IsComponentsV2,
		});
		return null;
	}
}

async function enqueueAndPlay(
	ctx: CommandContext,
	player: MusicPlayer,
	tracks: QueueTrack[],
	result: ResolveQueryResult,
	removed = 0,
): Promise<void> {
	try {
		player.add(tracks, 0);
	} catch (err) {
		if (err instanceof PlayerError && err.code === "QUEUE_FULL") {
			await ctx.reply({
				components: [errorContainer("Queue Full", err.message)],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}
		throw err;
	}

	const wasIdle = player.currentTrack === null;
	if (wasIdle) {
		try {
			await player.play();
		} catch (err) {
			logger.error("Play", `Playback failed: ${(err as Error).message}`, err as Error);
			await ctx.reply({
				components: [
					errorContainer(
						"Playback Failed",
						"Could not start playing. The track may be unavailable.",
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}
	}

	await handleResult(ctx, result, tracks, player, wasIdle, removed);
}

export default defineCommand({
	name: "playtop",
	aliases: ["pt"],
	description: "Play a song or add it to the top of the queue",
	usage: "playtop <query | url>",
	slashUsage: "playtop <query | url>",
	category: "music",
	enabledSlash: true,
	slashData: {
		name: "playtop",
		description: "Play a song or add it to the top queue",
		options: [
			{
				type: ApplicationCommandOptionType.String,
				name: "query",
				description: "Song name or URL to play",
				required: true,
				autocomplete: false,
			},
		],
	},
	middleware: [
		Middleware.Cooldown(10),
		Middleware.GuildOnly(),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.FairplayModOnly(),
		Middleware.LinkGate(),
	],
	async execute(ctx) {
		await ctx.deferReply();

		const query = ctx.isSlash() ? ctx.options.getString("query", true) : ctx.args.join(" ");
		const voiceChannelId = ctx.member?.voice?.channel?.id;

		if (!voiceChannelId) {
			await ctx.reply({
				components: [
					errorContainer("No Voice Channel", "You must be in a voice channel to play music."),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		if (!query.trim()) {
			await ctx.reply({
				components: [errorContainer("Missing Query", "Provide a song name or URL to play.")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const result = await fetchSearchResult(ctx, query);
		if (!result) return;

		const candidateTracks =
			result.type === "playlist" ? result.tracks : result.tracks[0] ? [result.tracks[0]] : [];
		if (!candidateTracks.length) return;

		const { kept: rawTracks, removed } = filterShortTracks(candidateTracks);
		if (!rawTracks.length) {
			await ctx.reply({
				components: [
					errorContainer(
						"Track Too Short",
						"Tracks under 45 seconds and live streams can't be played.",
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const player = await resolvePlayer(ctx, voiceChannelId);
		if (!player) return;

		const stageResult = await unsuppressIfStage(ctx.guild, voiceChannelId, ctx.client);
		if (!stageResult.ok) {
			await ctx.reply({
				components: [
					errorContainer(
						"Stage Channel",
						stageResult.reason ?? "I couldn't become a speaker in this Stage channel.",
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const requester = {
			id: ctx.user.id,
			username: ctx.user.username,
			displayName: ctx.user.displayName,
		};
		const now = Date.now();
		const tracks: QueueTrack[] = rawTracks.map((t) => ({ ...t, requester, addedAt: now }));

		await enqueueAndPlay(ctx, player, tracks, result, removed);
	},
});
