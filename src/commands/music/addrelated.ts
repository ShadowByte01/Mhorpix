import {
	ApplicationCommandOptionType,
	ComponentType,
	type Message,
	MessageFlags,
} from "discord.js";
import { getRedis } from "../../db/redis.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import type { MusicPlayer, QueueTrack } from "../../structures/music/index.js";
import { SearchSource } from "../../structures/music/index.js";
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

const REC_API = "";
const TARGET = 10;
const MAX_SEEDS = 5;
const GEN_COOLDOWN = 120;
const PREVIEW_PER_PAGE = 5;
const COLLECTOR_TIME = 300_000;

interface RelTrack {
	readonly encoded: string;
	readonly identifier: string;
	readonly title: string;
	readonly author: string;
	readonly duration: number;
	readonly uri: string | null;
	readonly artworkUrl: string | null;
}

interface State {
	page: number;
	tracks: RelTrack[];
	added: Set<string>;
	seedLabel: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function truncate(text: string, len: number): string {
	if (!text) return "Unknown";
	return text.length > len ? `${text.slice(0, len - 3)}...` : text;
}

function fmtDur(ms: number): string {
	if (!ms || ms < 0) return "Live";
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const sec = s % 60;
	return `${m}:${sec.toString().padStart(2, "0")}`;
}

function excludeSet(player: MusicPlayer): Set<string> {
	const ids = new Set<string>();
	if (player.currentTrack?.info?.identifier) ids.add(player.currentTrack.info.identifier);
	for (const t of player.queue.toArray()) {
		if (t.info?.identifier) ids.add(t.info.identifier);
	}
	return ids;
}

function seedsFrom(tracks: QueueTrack[]): string[] {
	const ids: string[] = [];
	for (const t of tracks) {
		if (ids.length >= MAX_SEEDS) break;
		if (t.info?.sourceName === "spotify" && t.info.identifier && !ids.includes(t.info.identifier)) {
			ids.push(t.info.identifier);
		}
	}
	return ids;
}

async function fetchOne(id: string): Promise<RelTrack[]> {
	try {
		const res = await fetch(`${REC_API}?endpoint=recommendations&id=${id}&limit=100`);
		if (!res.ok) return [];
		const json = (await res.json()) as {
			data?: {
				tracks?: Array<{
					encoded: string;
					info: {
						sourceName: string;
						identifier: string;
						title: string;
						author: string;
						duration: number;
						length: number;
						uri: string | null;
						artworkUrl?: string | null;
					};
				}>;
			};
		};
		return (json?.data?.tracks ?? [])
			.filter((t) => t?.info?.sourceName === "spotify" && Boolean(t.info.identifier))
			.map((t) => ({
				encoded: t.encoded,
				identifier: t.info.identifier,
				title: t.info.title || "Unknown",
				author: t.info.author || "Unknown",
				duration: t.info.duration ?? t.info.length ?? 0,
				uri: t.info.uri || null,
				artworkUrl: t.info.artworkUrl ?? null,
			}));
	} catch {
		return [];
	}
}

async function genRelated(seedIds: string[], exclude: Set<string>): Promise<RelTrack[]> {
	const perSeed = Math.ceil(TARGET / seedIds.length);
	const buckets: RelTrack[][] = [];

	for (const id of seedIds) {
		//biome-ignore lint/performance/noAwaitInLoops: sequential to respect the resolver's rate limit
		const tracks = await fetchOne(id);
		buckets.push(tracks);
		await sleep(3000);
	}

	const used = new Set<string>([...seedIds, ...exclude]);
	const result: RelTrack[] = [];
	const idx = new Array(buckets.length).fill(0);
	const counts = new Array(buckets.length).fill(0);

	let progress = true;
	while (result.length < TARGET && progress) {
		progress = false;
		for (let b = 0; b < buckets.length; b++) {
			if (result.length >= TARGET) break;
			if (counts[b] >= perSeed) continue;
			const bucket = buckets[b];
			if (!bucket) continue;
			while (idx[b] < bucket.length) {
				const track = bucket[idx[b]];
				idx[b]++;
				if (!track || used.has(track.identifier)) continue;
				used.add(track.identifier);
				result.push(track);
				counts[b]++;
				progress = true;
				break;
			}
		}
	}

	for (let b = 0; b < buckets.length && result.length < TARGET; b++) {
		const bucket = buckets[b];
		if (!bucket) continue;
		while (idx[b] < bucket.length && result.length < TARGET) {
			const track = bucket[idx[b]];
			idx[b]++;
			if (!track || used.has(track.identifier)) continue;
			used.add(track.identifier);
			result.push(track);
		}
	}

	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = result[i];
		const swap = result[j];
		if (tmp === undefined || swap === undefined) continue;
		result[i] = swap;
		result[j] = tmp;
	}

	return result;
}

async function findTrack(ctx: CommandContext, query: string): Promise<RelTrack | null> {
	try {
		const result = await ctx.client.music.search(query, SearchSource.Spotify);
		const first = result?.tracks?.[0];
		if (!first?.info?.identifier || first.info.sourceName !== "spotify") return null;
		return {
			encoded: first.encoded,
			identifier: first.info.identifier,
			title: first.info.title || "Unknown",
			author: first.info.author || "Unknown",
			duration: first.info.length ?? 0,
			uri: first.info.uri || null,
			artworkUrl: first.info.artworkUrl ?? null,
		};
	} catch {
		return null;
	}
}

async function enqueue(player: MusicPlayer, ctx: CommandContext, track: RelTrack) {
	player.queue.add({
		encoded: track.encoded,
		info: {
			identifier: track.identifier,
			title: track.title,
			author: track.author,
			length: track.duration,
			uri: track.uri ?? undefined,
			artworkUrl: track.artworkUrl ?? undefined,
			isStream: false,
			isSeekable: true,
			position: 0,
			sourceName: "spotify",
		},
		pluginInfo: {},
		requester: {
			id: ctx.member.id,
			username: ctx.member.user.username,
			displayName: ctx.member.displayName,
		},
		addedAt: Date.now(),
	});
}

function buildPicker(current: QueueTrack, queueCount: number, disabled = false) {
	return defContainer()
		.addTextDisplayComponents(TextDisplay("### Add Related Songs"))
		.addSeparatorComponents(Separator())
		.addTextDisplayComponents(
			TextDisplay(`-# Now playing: **${truncate(current.info?.title ?? "Unknown", 60)}**`),
		)
		.addTextDisplayComponents(TextDisplay("Base recommendations on:"))
		.addSeparatorComponents(Separator(false))
		.addActionRowComponents(
			ActionRow().addComponents(
				primaryButton("1️⃣ Now Playing", "arel:seed_now", disabled),
				secondaryButton(
					`2️⃣ Queue (${queueCount} track${queueCount !== 1 ? "s" : ""})`,
					"arel:seed_queue",
					disabled,
				),
			),
		);
}

function buildLoading() {
	return defContainer().addTextDisplayComponents(
		TextDisplay(`### Generating...\n\n-# Finding **${TARGET}** related tracks`),
	);
}

function buildDone(state: State) {
	return successContainer()
		.addTextDisplayComponents(TextDisplay("### Added"))
		.addSeparatorComponents(Separator())
		.addTextDisplayComponents(
			TextDisplay(
				`-# ${state.added.size} track${state.added.size !== 1 ? "s" : ""} added to the queue`,
			),
		);
}

function buildPreview(state: State, disabled = false) {
	const totalPages = Math.max(1, Math.ceil(state.tracks.length / PREVIEW_PER_PAGE));
	const page = Math.min(state.page, totalPages - 1);
	const start = page * PREVIEW_PER_PAGE;
	const end = Math.min(start + PREVIEW_PER_PAGE, state.tracks.length);

	const container = defContainer()
		.addTextDisplayComponents(TextDisplay("### Related Songs"))
		.addSeparatorComponents(Separator())
		.addTextDisplayComponents(TextDisplay(`-# Based on: ${state.seedLabel}`))
		.addSeparatorComponents(Separator());

	for (let i = start; i < end; i++) {
		const track = state.tracks[i];
		if (!track) continue;
		const already = state.added.has(track.identifier);
		const label = track.uri
			? `**[${truncate(track.title, 45)}](${track.uri})**\n-# ${truncate(track.author, 35)} • ${fmtDur(track.duration)}`
			: `**${truncate(track.title, 45)}**\n-# ${truncate(track.author, 35)} • ${fmtDur(track.duration)}`;

		const section = baseSection().addTextDisplayComponents(TextDisplay(label));
		section.setButtonAccessory(
			already
				? secondaryButton("Added", `arel:added:${i}`, true)
				: primaryButton("Add", `arel:add:${i}`, disabled),
		);
		container.addSectionComponents(section);
		if (i < end - 1) container.addSeparatorComponents(Separator(false));
	}

	container.addSeparatorComponents(Separator());

	const nav = ActionRow();
	if (totalPages > 1) {
		nav.addComponents(
			secondaryButton("prev", "arel:prev", disabled || page === 0),
			secondaryButton("next", "arel:next", disabled || page >= totalPages - 1),
		);
	}
	const remaining = state.tracks.some((t) => !state.added.has(t.identifier));
	nav.addComponents(primaryButton("Add All", "arel:add_all", disabled || !remaining));
	container.addActionRowComponents(nav);

	container.addTextDisplayComponents(
		TextDisplay(
			`-# ${state.tracks.length} track${state.tracks.length !== 1 ? "s" : ""}${totalPages > 1 ? ` • Page ${page + 1}/${totalPages}` : ""}`,
		),
	);

	return container;
}

function attachPreviewCollector(
	msg: Message,
	ctx: CommandContext,
	player: MusicPlayer,
	state: State,
) {
	const collector = msg.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: COLLECTOR_TIME,
		filter: (i) => i.user.id === ctx.user.id,
	});

	collector.on("collect", async (i) => {
		await i.deferUpdate();

		if (i.customId === "arel:prev") {
			state.page = Math.max(0, state.page - 1);
			await msg.edit({ components: [buildPreview(state)] });
			return;
		}

		if (i.customId === "arel:next") {
			const totalPages = Math.max(1, Math.ceil(state.tracks.length / PREVIEW_PER_PAGE));
			state.page = Math.min(totalPages - 1, state.page + 1);
			await msg.edit({ components: [buildPreview(state)] });
			return;
		}

		if (i.customId.startsWith("arel:add:")) {
			const idx = Number(i.customId.slice("arel:add:".length));
			const track = state.tracks[idx];
			if (track && !state.added.has(track.identifier)) {
				await enqueue(player, ctx, track);
				state.added.add(track.identifier);
			}
			if (state.tracks.every((t) => state.added.has(t.identifier))) {
				collector.stop("done");
				await msg.edit({ components: [buildDone(state)] });
				return;
			}
			await msg.edit({ components: [buildPreview(state)] });
			return;
		}

		if (i.customId === "arel:add_all") {
			const pending = state.tracks.filter((t) => !state.added.has(t.identifier));
			await Promise.all(pending.map((t) => enqueue(player, ctx, t)));
			for (const t of pending) state.added.add(t.identifier);
			collector.stop("done");
			await msg.edit({ components: [buildDone(state)] });
		}
	});

	collector.on("end", (_collected, reason) => {
		if (reason !== "done") {
			msg.edit({ components: [buildPreview(state, true)] }).catch(() => undefined);
		}
	});
}

async function runGeneration(
	ctx: CommandContext,
	msg: Message,
	player: MusicPlayer,
	seedTracks: QueueTrack[],
	seedLabel: string,
	redis: ReturnType<typeof getRedis>,
	rlKey: string,
) {
	const seedIds = seedsFrom(seedTracks);

	if (!seedIds.length) {
		await msg.edit({
			components: [
				errorContainer(
					"No Spotify Tracks",
					"Couldn't find a Spotify track to base recommendations on.",
				),
			],
		});
		return;
	}

	await msg.edit({ components: [buildLoading()] });
	await redis.set(rlKey, "1", "EX", GEN_COOLDOWN);
	const tracks = await genRelated(seedIds, excludeSet(player));

	if (!tracks.length) {
		await redis.del(rlKey);
		await msg.edit({
			components: [
				errorContainer(
					"Generation Failed",
					"Could not find related songs right now. Try again shortly.",
				),
			],
		});
		return;
	}

	const state: State = { page: 0, tracks, added: new Set(), seedLabel };
	await msg.edit({ components: [buildPreview(state)] });
	attachPreviewCollector(msg, ctx, player, state);
}

function attachPicker(
	msg: Message,
	ctx: CommandContext,
	player: MusicPlayer,
	current: QueueTrack,
	redis: ReturnType<typeof getRedis>,
	rlKey: string,
) {
	const collector = msg.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: COLLECTOR_TIME,
		filter: (i) => i.user.id === ctx.user.id,
		max: 1,
	});

	collector.on("collect", async (i) => {
		await i.deferUpdate();

		if (i.customId === "arel:seed_now") {
			await runGeneration(ctx, msg, player, [current], "Now Playing", redis, rlKey);
			return;
		}

		if (i.customId === "arel:seed_queue") {
			const queueTracks = [...player.queue.toArray()];
			await runGeneration(
				ctx,
				msg,
				player,
				queueTracks,
				`Queue (${queueTracks.length} track${queueTracks.length !== 1 ? "s" : ""})`,
				redis,
				rlKey,
			);
		}
	});

	collector.on("end", (collected) => {
		if (!collected.size) {
			msg
				.edit({ components: [buildPicker(current, player.queue.size, true)] })
				.catch(() => undefined);
		}
	});
}

export default defineCommand({
	name: "addrelated",
	aliases: ["addrel"],
	description: "Add songs related to what's playing to the queue",
	category: "music",
	usage: "addrelated [song]",
	slashUsage: "addrelated [song]",
	enabledSlash: true,
	slashData: {
		name: "addrelated",
		description: "Add songs related to what's playing to the queue",
		options: [
			{
				type: ApplicationCommandOptionType.String,
				name: "song",
				description: "Base recommendations on this song instead",
				required: false,
			},
		],
	},
	middleware: [
		Middleware.Cooldown(15),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.PlayerCheck("playing"),
	],
	async execute(ctx: CommandContext) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		const current = player?.currentTrack;
		if (!player || !current) {
			await ctx.reply({
				components: [errorContainer("Nothing Playing", "No track is currently playing.")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const redis = getRedis();
		const rlKey = `arel:rl:${ctx.user.id}`;
		const onCd = await redis.get(rlKey);
		if (onCd) {
			const ttl = await redis.ttl(rlKey);
			await ctx.reply({
				components: [
					errorContainer(
						"Cooldown",
						`You can generate related songs again in **${ttl > 0 ? ttl : GEN_COOLDOWN}s**.`,
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const query = (ctx.isSlash() ? ctx.options.getString("song") : ctx.args.join(" ")) ?? "";

		if (query.trim()) {
			const msg = await ctx.reply({
				components: [
					defContainer().addTextDisplayComponents(
						TextDisplay(`### Searching\n-# Looking up **${truncate(query.trim(), 60)}**...`),
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});

			const found = await findTrack(ctx, query.trim());
			if (!found) {
				await msg.edit({
					components: [
						errorContainer(
							"Not Found",
							`Couldn't find a Spotify match for **${truncate(query.trim(), 60)}**.`,
						),
					],
				});
				return;
			}

			await msg.edit({ components: [buildLoading()] });
			await redis.set(rlKey, "1", "EX", GEN_COOLDOWN);
			const tracks = await genRelated([found.identifier], excludeSet(player));

			if (!tracks.length) {
				await redis.del(rlKey);
				await msg.edit({
					components: [
						errorContainer(
							"Generation Failed",
							"Could not find related songs right now. Try again shortly.",
						),
					],
				});
				return;
			}

			const state: State = {
				page: 0,
				tracks,
				added: new Set(),
				seedLabel: truncate(found.title, 40),
			};
			await msg.edit({ components: [buildPreview(state)] });
			attachPreviewCollector(msg, ctx, player, state);
			return;
		}

		const queueTracks = [...player.queue.toArray()];

		if (queueTracks.length === 0) {
			const msg = await ctx.reply({
				components: [buildLoading()],
				flags: MessageFlags.IsComponentsV2,
			});
			await runGeneration(ctx, msg, player, [current], "Now Playing", redis, rlKey);
			return;
		}

		const msg = await ctx.reply({
			components: [buildPicker(current, queueTracks.length)],
			flags: MessageFlags.IsComponentsV2,
		});
		attachPicker(msg, ctx, player, current, redis, rlKey);
	},
});
