import type { ButtonInteraction, CacheType } from "discord.js";
import { ComponentType, MessageFlags } from "discord.js";
import { getTracks, getUserPlaylists } from "../../db/stores/playlists.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import type { MusicPlayer, QueueTrack } from "../../structures/music/index.js";
import { ManagerError, PlayerError } from "../../structures/music/index.js";
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
import { logger } from "../../utils/logger.js";
import { unsuppressIfStage } from "../../utils/stage.js";
import { TrackDecoder } from "../../utils/trackDecoder.js";

const PAGE_SIZE = 5;
const COLLECTOR_TIME = 300_000;

type ViewMode = "list" | "detail";

interface DetailTrack {
	readonly encoded: string;
	readonly title: string;
	readonly author: string;
	readonly uri: string | null;
	readonly length: number;
	readonly isStream: boolean;
}

function timeAgo(ms: number): string {
	const seconds = Math.floor((Date.now() - ms) / 1000);
	const units: [string, number][] = [
		["year", 31536000],
		["month", 2592000],
		["week", 604800],
		["day", 86400],
		["hour", 3600],
		["minute", 60],
	];
	for (const [unit, secs] of units) {
		const n = Math.floor(seconds / secs);
		if (n >= 1) return `${n} ${unit}${n !== 1 ? "s" : ""} ago`;
	}
	return "just now";
}

function sanitizeTitle(title: string, maxLen: number): string {
	const cleaned = title.replace(/[[\]()]/g, "").trim();
	return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 3)}...` : cleaned;
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
		logger.warn("Playlists", `Failed to create player: ${(err as Error).message}`);
		return null;
	}
}

function toQueueTrack(
	decoded: ReturnType<typeof TrackDecoder.decode>,
	encoded: string,
	requester: { id: string; username: string; displayName: string },
): QueueTrack {
	return {
		encoded,
		info: decoded.info as unknown as QueueTrack["info"],
		pluginInfo: decoded.pluginInfo,
		requester,
		addedAt: Date.now(),
	};
}

async function playTracks(
	ctx: CommandContext,
	interaction: ButtonInteraction<CacheType>,
	tracks: readonly DetailTrack[],
	shuffle: boolean,
): Promise<void> {
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const voiceChannelId = ctx.member?.voice?.channel?.id;
	if (!voiceChannelId) {
		await interaction.editReply({
			components: [
				errorContainer("No Voice Channel", "You must be in a voice channel to play music."),
			],
			flags: MessageFlags.IsComponentsV2,
		});
		return;
	}

	const player = await resolvePlayer(ctx, voiceChannelId);
	if (!player) {
		await interaction.editReply({
			components: [errorContainer("Connection Failed", "Could not join your voice channel.")],
			flags: MessageFlags.IsComponentsV2,
		});
		return;
	}

	const stageResult = await unsuppressIfStage(ctx.guild, voiceChannelId, ctx.client);
	if (!stageResult.ok) {
		await interaction.editReply({
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

	const queueTracks: QueueTrack[] = [];
	for (const t of tracks) {
		try {
			const decoded = TrackDecoder.decode(t.encoded);
			queueTracks.push(toQueueTrack(decoded, t.encoded, requester));
		} catch {
			// skip
		}
	}

	if (shuffle) {
		queueTracks.sort(() => Math.random() - 0.5);
	}

	if (queueTracks.length === 0) {
		await interaction.editReply({
			components: [errorContainer("Nothing to Play", "Those tracks could not be decoded.")],
			flags: MessageFlags.IsComponentsV2,
		});
		return;
	}

	try {
		player.add(queueTracks);
	} catch (err) {
		if (err instanceof PlayerError && err.code === "QUEUE_FULL") {
			await interaction.editReply({
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
			logger.error("Playlists", `Playback failed: ${(err as Error).message}`, err as Error);
			await interaction.editReply({
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

	const container = successContainer();
	const firstTrack = queueTracks[0];
	if (queueTracks.length === 1 && firstTrack) {
		container.addTextDisplayComponents(
			TextDisplay(
				`### Added to Queue\n\n**[${firstTrack.info.title}](${firstTrack.info.uri ?? ""})**\n-# ${firstTrack.info.author}`,
			),
		);
	} else {
		container.addTextDisplayComponents(
			TextDisplay(
				`### Added to Queue\n\n-# ${queueTracks.length} track${queueTracks.length !== 1 ? "s" : ""} added${shuffle ? " (shuffled)" : ""}`,
			),
		);
	}

	await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

export default defineCommand({
	name: "playlists",
	aliases: ["pllist", "playlist-list"],
	description: "View and play your playlists",
	category: "library",
	enabledSlash: true,
	slashData: {
		name: "playlists",
		description: "View and play your playlists",
	},
	middleware: [Middleware.Cooldown(10)],
	async execute(ctx: CommandContext) {
		let mode: ViewMode = "list";
		let page = 0;
		let plIndex: number | null = null;
		let trackPage = 0;
		let detailTracks: DetailTrack[] = [];

		const stored = await getUserPlaylists(ctx.user.id);

		if (!stored.length) {
			await ctx.reply({
				components: [
					errorContainer("No Playlists", "Use `/playlist-create` to make your first playlist."),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const buildList = (disable: boolean = false) => {
			const pageCount = Math.max(1, Math.ceil(stored.length / PAGE_SIZE));
			page = Math.min(page, pageCount - 1);
			const start = page * PAGE_SIZE;
			const pageItems = stored.slice(start, start + PAGE_SIZE);

			const container = defContainer().addTextDisplayComponents(TextDisplay("### Your Playlists"));
			container.addSeparatorComponents(Separator());

			pageItems.forEach((pl, i) => {
				const globalIndex = start + i;
				const section = baseSection().addTextDisplayComponents(
					TextDisplay(
						`**${pl.name}**\n-# ${pl.trackCount} track${pl.trackCount !== 1 ? "s" : ""} • Created ${timeAgo(pl.createdAt.getTime())}`,
					),
				);
				section.setButtonAccessory(primaryButton("View", `pllist:view:${globalIndex}`, disable));
				container.addSectionComponents(section);
				if (i < pageItems.length - 1) container.addSeparatorComponents(Separator(false));
			});

			container.addSeparatorComponents(Separator());

			if (pageCount > 1) {
				container.addActionRowComponents(
					ActionRow().addComponents(
						secondaryButton("prev", "pllist:prev", disable || page === 0),
						secondaryButton("next", "pllist:next", disable || page >= pageCount - 1),
					),
				);
			}

			container.addTextDisplayComponents(
				TextDisplay(
					`-# ${stored.length} playlist${stored.length !== 1 ? "s" : ""}${pageCount > 1 ? ` • Page ${page + 1}/${pageCount}` : ""}`,
				),
			);

			return container;
		};

		const buildDetail = (disable: boolean = false) => {
			const pl = plIndex !== null ? stored[plIndex] : null;
			if (!pl) return buildList(disable);

			const pageCount = Math.max(1, Math.ceil(detailTracks.length / PAGE_SIZE));
			trackPage = Math.min(trackPage, pageCount - 1);
			const start = trackPage * PAGE_SIZE;
			const pageItems = detailTracks.slice(start, start + PAGE_SIZE);

			const container = defContainer()
				.addTextDisplayComponents(TextDisplay(`### ${pl.name}`))
				.addSeparatorComponents(Separator())
				.addTextDisplayComponents(TextDisplay(`-# ID: \`${pl.id}\` • ${pl.trackCount} tracks`));

			if (!pageItems.length) {
				container.addSeparatorComponents(Separator());
				container.addTextDisplayComponents(TextDisplay("-# Empty playlist"));
			} else {
				container.addSeparatorComponents(Separator());
				pageItems.forEach((t, i) => {
					const globalIndex = start + i;
					const duration = t.isStream ? "Live" : TrackDecoder.formatDuration(t.length);
					const section = baseSection().addTextDisplayComponents(
						TextDisplay(
							`**[${sanitizeTitle(t.title, 50)}](${t.uri ?? ""})**\n-# ${t.author} • ${duration}`,
						),
					);
					section.setButtonAccessory(primaryButton("Play", `pllist:play:${globalIndex}`, disable));
					container.addSectionComponents(section);
					if (i < pageItems.length - 1) container.addSeparatorComponents(Separator(false));
				});
			}

			container.addSeparatorComponents(Separator());

			if (pageCount > 1) {
				container.addActionRowComponents(
					ActionRow().addComponents(
						secondaryButton("prev", "pllist:tprev", disable || trackPage === 0),
						secondaryButton("next", "pllist:tnext", disable || trackPage >= pageCount - 1),
					),
				);
			}

			container.addActionRowComponents(
				ActionRow().addComponents(
					primaryButton("Play All", "pllist:playall", disable),
					secondaryButton("Shuffle", "pllist:shuffle", disable),
					secondaryButton("Back", "pllist:back", disable),
				),
			);

			container.addTextDisplayComponents(
				TextDisplay(
					`-# ${detailTracks.length} track${detailTracks.length !== 1 ? "s" : ""}${pageCount > 1 ? ` • Page ${trackPage + 1}/${pageCount}` : ""}`,
				),
			);

			return container;
		};

		const build = (disable: boolean = false) =>
			mode === "list" ? buildList(disable) : buildDetail(disable);

		const message = await ctx.reply({
			components: [build()],
			flags: MessageFlags.IsComponentsV2,
		});

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: COLLECTOR_TIME,
			filter: (i) => i.user.id === ctx.user.id,
		});

		collector.on("collect", async (i) => {
			try {
				if (i.customId === "pllist:playall" || i.customId === "pllist:shuffle") {
					await playTracks(ctx, i, detailTracks, i.customId === "pllist:shuffle");
					return;
				}

				if (i.customId.startsWith("pllist:play:")) {
					const idx = Number(i.customId.slice("pllist:play:".length));
					const target = detailTracks[idx];
					if (target) await playTracks(ctx, i, [target], false);
					return;
				}

				if (i.customId.startsWith("pllist:view:")) {
					await i.deferUpdate();
					const idx = Number(i.customId.slice("pllist:view:".length));
					plIndex = idx;
					trackPage = 0;
					mode = "detail";

					const pl = stored[idx];
					if (pl) {
						const raw = await getTracks(pl.id);
						detailTracks = raw
							.map((trackEntry) => {
								try {
									const decodedTrack = TrackDecoder.decode(trackEntry.encoded);
									return {
										encoded: trackEntry.encoded,
										title: decodedTrack.info.title,
										author: decodedTrack.info.author,
										uri: decodedTrack.info.uri,
										length: decodedTrack.info.length,
										isStream: decodedTrack.info.isStream,
									};
								} catch {
									return null;
								}
							})
							.filter((x): x is DetailTrack => x !== null);
					}
					await message.edit({ components: [build()] });
					return;
				}

				if (i.customId === "pllist:back") {
					await i.deferUpdate();
					mode = "list";
					plIndex = null;
					trackPage = 0;
					detailTracks = [];
					await message.edit({ components: [build()] });
					return;
				}

				if (i.customId === "pllist:prev") {
					await i.deferUpdate();
					page = Math.max(0, page - 1);
					await message.edit({ components: [build()] });
					return;
				}

				if (i.customId === "pllist:next") {
					await i.deferUpdate();
					page += 1;
					await message.edit({ components: [build()] });
					return;
				}

				if (i.customId === "pllist:tprev") {
					await i.deferUpdate();
					trackPage = Math.max(0, trackPage - 1);
					await message.edit({ components: [build()] });
					return;
				}

				if (i.customId === "pllist:tnext") {
					await i.deferUpdate();
					trackPage += 1;
					await message.edit({ components: [build()] });
					return;
				}
			} catch (err) {
				logger.error("Playlists", `Collector error: ${(err as Error).message}`, err as Error);
			}
		});

		collector.on("end", (_collected, reason) => {
			if (reason === "time") {
				message.edit({ components: [build(true)] }).catch(() => undefined);
			}
		});
	},
});
