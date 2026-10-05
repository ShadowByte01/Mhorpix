import type { ButtonInteraction, CacheType } from "discord.js";
import { ComponentType, MessageFlags } from "discord.js";
import { emoji } from "../../config/emoji.js";
import {
	clearHistory,
	getHistory,
	getHistoryLimit,
	type HistoryEntry,
	removeFromHistory,
} from "../../db/stores/music.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import type { MusicPlayer, QueueTrack } from "../../structures/music/index.js";
import { ManagerError, PlayerError } from "../../structures/music/index.js";
import { defineCommand } from "../../types/index.js";
import {
	ActionRow,
	baseSection,
	dangerButton,
	defContainer,
	emojiSecondaryButton,
	errorContainer,
	primaryButton,
	Separator,
	secondaryButton,
	successContainer,
	TextDisplay,
} from "../../utils/components.js";
import { logger } from "../../utils/logger.js";
import { unsuppressIfStage } from "../../utils/stage.js";
import { type DecodedTrack, TrackDecoder } from "../../utils/trackDecoder.js";

const PAGE_SIZE = 5;
const COLLECTOR_TIME = 300_000;

type ViewMode = "list" | "edit";

interface DisplayEntry {
	readonly encoded: string;
	readonly title: string;
	readonly author: string;
	readonly uri: string | null;
	readonly length: number;
	readonly isStream: boolean;
	readonly playedAt: number;
}

function decodeForDisplay(history: readonly HistoryEntry[]): DisplayEntry[] {
	const entries: DisplayEntry[] = [];
	for (const h of history) {
		try {
			const decoded = TrackDecoder.decode(h.encoded);
			entries.push({
				encoded: h.encoded,
				title: decoded.info.title,
				author: decoded.info.author,
				uri: decoded.info.uri,
				length: decoded.info.length,
				isStream: decoded.info.isStream,
				playedAt: h.playedAt,
			});
		} catch {
			// Corrupt / unparsable encoded string — skip rather than crash the list.
		}
	}
	return entries;
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

/** Mirrors favourites.ts's resolvePlayer — get the existing player or spin one up. */
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
		logger.warn("History", `Failed to create player: ${(err as Error).message}`);
		return null;
	}
}

function toQueueTrack(
	decoded: DecodedTrack,
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

async function playHistory(
	ctx: CommandContext,
	interaction: ButtonInteraction<CacheType>,
	entries: readonly HistoryEntry[],
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
	const tracks: QueueTrack[] = [];
	for (const h of entries) {
		try {
			tracks.push(toQueueTrack(TrackDecoder.decode(h.encoded), h.encoded, requester));
		} catch {
			// Skip history entries whose encoded string no longer decodes.
		}
	}

	if (tracks.length === 0) {
		await interaction.editReply({
			components: [errorContainer("Nothing to Play", "Those tracks could not be decoded.")],
			flags: MessageFlags.IsComponentsV2,
		});
		return;
	}

	try {
		player.add(tracks);
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
			logger.error("History", `Playback failed: ${(err as Error).message}`, err as Error);
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
	if (tracks.length === 1) {
		const track = tracks[0] as QueueTrack;
		container.addTextDisplayComponents(
			TextDisplay(
				`### Added to Queue\n\n**[${track.info.title}](${track.info.uri ?? ""})**\n-# ${track.info.author}`,
			),
		);
	} else {
		container.addTextDisplayComponents(
			TextDisplay(`### Added to Queue\n\n-# ${tracks.length} tracks added`),
		);
	}

	await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

export default defineCommand({
	name: "history",
	aliases: ["hist", "listeninghistory"],
	description: "View, replay, and manage your listening history",
	category: "library",
	enabledSlash: true,
	slashData: {
		name: "history",
		description: "View, replay, and manage your listening history",
	},
	middleware: [Middleware.Cooldown(15), Middleware.VoteRequired()],
	async execute(ctx: CommandContext) {
		let mode: ViewMode = "list";
		let page = 0;
		let stored = await getHistory(ctx.user.id);
		const limit = await getHistoryLimit(ctx.user.id);

		if (stored.length === 0) {
			await ctx.reply({
				components: [errorContainer("No History", "Start listening to build your history.")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const build = (disable: boolean = false) => {
			const decoded = decodeForDisplay(stored);
			const pageCount = Math.max(1, Math.ceil(decoded.length / PAGE_SIZE));
			page = Math.min(page, pageCount - 1);
			const start = page * PAGE_SIZE;
			const pageItems = decoded.slice(start, start + PAGE_SIZE);

			const container = defContainer().addTextDisplayComponents(
				TextDisplay(mode === "list" ? "### Listening History" : "## Edit History"),
			);
			container.addSeparatorComponents(Separator());

			pageItems.forEach((h, i) => {
				const globalIndex = start + i;
				const duration = h.isStream ? "Live" : TrackDecoder.formatDuration(h.length);

				const section = baseSection().addTextDisplayComponents(
					TextDisplay(
						mode === "list"
							? `**[${sanitizeTitle(h.title, 50)}](${h.uri ?? ""})**\n-# ${h.author} • ${duration} • Played ${timeAgo(h.playedAt)}`
							: `**[${sanitizeTitle(h.title, 50)}](${h.uri ?? ""})**\n-# ${h.author} • ${duration}`,
					),
				);

				section.setButtonAccessory(
					mode === "list"
						? primaryButton("Play", `history:play:${globalIndex}`, disable)
						: dangerButton("Remove", `history:remove:${globalIndex}`, disable),
				);

				container.addSectionComponents(section);
				if (i < pageItems.length - 1) container.addSeparatorComponents(Separator(false));
			});

			container.addSeparatorComponents(Separator());

			if (pageCount > 1) {
				container.addActionRowComponents(
					ActionRow().addComponents(
						emojiSecondaryButton("history:prev", emoji.get("left"), disable || page === 0),
						emojiSecondaryButton(
							"history:next",
							emoji.get("right"),
							disable || page >= pageCount - 1,
						),
					),
				);
			}

			container.addActionRowComponents(
				mode === "list"
					? ActionRow().addComponents(
							secondaryButton("Play All", "history:playall", disable),
							secondaryButton("Edit", "history:edit", disable),
						)
					: ActionRow().addComponents(
							secondaryButton("Back", "history:back", disable),
							dangerButton("Clear All", "history:clearall", disable),
						),
			);

			container.addTextDisplayComponents(
				TextDisplay(
					`-# ${decoded.length}/${limit} tracks${pageCount > 1 ? ` • Page ${page + 1}/${pageCount}` : ""} • ${
						mode === "list" ? "Click Play to queue" : "Click Remove to delete"
					}`,
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
				if (i.customId === "history:playall") {
					await playHistory(ctx, i, stored);
					return;
				}

				if (i.customId.startsWith("history:play:")) {
					const idx = Number(i.customId.slice("history:play:".length));
					const target = stored[idx];
					if (target) await playHistory(ctx, i, [target]);
					return;
				}

				if (i.customId.startsWith("history:remove:")) {
					await i.deferUpdate();
					const idx = Number(i.customId.slice("history:remove:".length));
					const target = stored[idx];
					if (target) await removeFromHistory(ctx.user.id, target.encoded);
					stored = await getHistory(ctx.user.id);

					if (stored.length === 0) {
						collector.stop();
						await message.edit({
							components: [
								successContainer().addTextDisplayComponents(
									TextDisplay("### History Empty\n\n-# All tracks removed from history"),
								),
							],
							flags: MessageFlags.IsComponentsV2,
						});
						return;
					}

					await message.edit({ components: [build()], flags: MessageFlags.IsComponentsV2 });
					return;
				}

				if (i.customId === "history:clearall") {
					await i.deferUpdate();
					await clearHistory(ctx.user.id);
					collector.stop();
					await message.edit({
						components: [
							successContainer().addTextDisplayComponents(
								TextDisplay("### History Cleared\n\n-# All listening history has been removed"),
							),
						],
						flags: MessageFlags.IsComponentsV2,
					});
					return;
				}

				if (i.customId === "history:edit") {
					await i.deferUpdate();
					mode = "edit";
					await message.edit({ components: [build()], flags: MessageFlags.IsComponentsV2 });
					return;
				}

				if (i.customId === "history:back") {
					await i.deferUpdate();
					mode = "list";
					await message.edit({ components: [build()], flags: MessageFlags.IsComponentsV2 });
					return;
				}

				if (i.customId === "history:prev") {
					await i.deferUpdate();
					page = Math.max(0, page - 1);
					await message.edit({ components: [build()], flags: MessageFlags.IsComponentsV2 });
					return;
				}

				if (i.customId === "history:next") {
					await i.deferUpdate();
					page += 1;
					await message.edit({ components: [build()], flags: MessageFlags.IsComponentsV2 });
					return;
				}
			} catch (err) {
				logger.error("History", `Collector error: ${(err as Error).message}`, err as Error);
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
