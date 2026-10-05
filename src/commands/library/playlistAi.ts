import { ComponentType, MessageFlags, TextInputStyle } from "discord.js";
import { getRedis } from "../../db/redis.js";
import { getFavourites, getHistory } from "../../db/stores/music.js";
import {
	addTracks,
	createPlaylist,
	getPlaylistLimit,
	getUserPlaylistCount,
	getUserPlaylists,
} from "../../db/stores/playlists.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import { defineCommand } from "../../types/index.js";
import {
	ActionRow,
	baseSection,
	dangerButton,
	defContainer,
	errorContainer,
	Label,
	Modal,
	primaryButton,
	SelectMenu,
	Separator,
	secondaryButton,
	successContainer,
	TextDisplay,
	TextInput,
} from "../../utils/components.js";
import { TrackDecoder } from "../../utils/trackDecoder.js";

const REC_API = "https://sp-pl-bread.vercel.app/api/2";
const GEN_COOLDOWN = 300;
const MAX_SEEDS = 5;
const TARGET = 30;
const SEEDS_PER_PAGE = 25;
const PREVIEW_PER_PAGE = 5;
const COLLECTOR_TIME = 600_000;

interface SeedTrack {
	readonly encoded: string;
	readonly identifier: string;
	readonly title: string;
	readonly author: string;
	readonly duration: number;
	readonly uri: string | null;
	readonly isFav: boolean;
}

interface GeneratedTrack {
	readonly encoded: string;
	readonly identifier: string;
	readonly title: string;
	readonly author: string;
	readonly duration: number;
	readonly uri: string | null;
}

interface State {
	stage: "seed" | "generating" | "preview";
	page: number;
	selected: string[];
	generated: GeneratedTrack[];
	previewPage: number;
	plName: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function buildPool(
	favs: readonly { encoded: string }[],
	history: readonly { encoded: string }[],
): SeedTrack[] {
	const seen = new Set<string>();
	const pool: SeedTrack[] = [];

	const tryAdd = (encoded: string, isFav: boolean) => {
		try {
			const decodedTrack = TrackDecoder.decode(encoded);
			if (!decodedTrack.info) return;
			if (decodedTrack.info.sourceName !== "spotify") return;
			if (!decodedTrack.info.identifier) return;
			if (seen.has(decodedTrack.info.identifier)) return;
			seen.add(decodedTrack.info.identifier);
			pool.push({
				encoded,
				identifier: decodedTrack.info.identifier,
				title: decodedTrack.info.title || "Unknown",
				author: decodedTrack.info.author || "Unknown",
				duration: decodedTrack.info.length,
				uri: decodedTrack.info.uri || null,
				isFav,
			});
		} catch {
			// skip
		}
	};

	for (const f of favs) tryAdd(f.encoded, true);
	for (const h of history) tryAdd(h.encoded, false);

	return pool;
}

function sanitizeTitle(title: string, maxLen: number): string {
	const cleaned = title.replace(/[[\]()]/g, "").trim();
	return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 3)}...` : cleaned;
}

function truncate(text: string, maxLen: number): string {
	if (!text) return "";
	return text.length > maxLen ? `${text.slice(0, maxLen - 3)}...` : text;
}

async function getNextAiName(userId: string): Promise<string> {
	const owned = await getUserPlaylists(userId);
	const names = new Set(owned.map((p) => p.name.toLowerCase()));

	if (!names.has("ai playlist")) return "AI Playlist";

	let n = 2;
	while (names.has(`ai playlist ${n}`)) n++;
	return `AI Playlist ${n}`;
}

async function generate(seedIdentifiers: string[]): Promise<GeneratedTrack[]> {
	const perSeed = Math.ceil(TARGET / seedIdentifiers.length);
	const buckets: Array<
		{
			encoded: string;
			info: {
				identifier: string;
				title: string;
				author: string;
				duration: number;
				length: number;
				uri: string | null;
			};
		}[]
	> = [];

	for (const id of seedIdentifiers) {
		try {
			//biome-ignore lint/performance/noAwaitInLoops: intentionally sequential — each attempt needs to know whether this id collided in PG before generating the next one
			const res = await fetch(`${REC_API}?endpoint=recommendations&id=${id}&limit=100`);
			if (!res.ok) {
				buckets.push([]);
				continue;
			}
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
						};
					}>;
				};
			};
			const tracks = (json?.data?.tracks ?? []).filter(
				(track) => track?.info?.sourceName === "spotify" && Boolean(track.info.identifier),
			);
			buckets.push(tracks);
		} catch {
			buckets.push([]);
		}
		await sleep(3000);
	}

	const used = new Set<string>(seedIdentifiers);
	const result: GeneratedTrack[] = [];
	const indices = new Array(buckets.length).fill(0);
	const counts = new Array(buckets.length).fill(0);

	let progress = true;
	while (result.length < TARGET && progress) {
		progress = false;
		for (let seedIndex = 0; seedIndex < buckets.length; seedIndex++) {
			if (result.length >= TARGET) break;
			if (counts[seedIndex] >= perSeed) continue;

			const bucket = buckets[seedIndex];
			if (!bucket) continue;
			let added = false;
			while (indices[seedIndex] < bucket.length && !added) {
				const track = bucket[indices[seedIndex]];
				indices[seedIndex]++;
				if (!track?.info?.identifier) continue;
				if (used.has(track.info.identifier)) continue;
				used.add(track.info.identifier);
				result.push({
					encoded: track.encoded,
					identifier: track.info.identifier,
					title: track.info.title || "Unknown",
					author: track.info.author || "Unknown",
					duration: track.info.duration ?? track.info.length ?? 0,
					uri: track.info.uri || null,
				});
				counts[seedIndex]++;
				progress = true;
				added = true;
			}
		}
	}

	for (let seedIndex = 0; seedIndex < buckets.length && result.length < TARGET; seedIndex++) {
		const bucket = buckets[seedIndex];
		if (!bucket) continue;
		while (indices[seedIndex] < bucket.length && result.length < TARGET) {
			const track = bucket[indices[seedIndex]];
			indices[seedIndex]++;
			if (!track?.info?.identifier) continue;
			if (used.has(track.info.identifier)) continue;
			used.add(track.info.identifier);
			result.push({
				encoded: track.encoded,
				identifier: track.info.identifier,
				title: track.info.title || "Unknown",
				author: track.info.author || "Unknown",
				duration: track.info.duration ?? track.info.length ?? 0,
				uri: track.info.uri || null,
			});
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

export default defineCommand({
	name: "playlist-ai",
	aliases: ["plai"],
	description: "Generate an AI-powered playlist from your Spotify history",
	category: "library",
	enabledSlash: true,
	slashData: {
		name: "playlist-ai",
		description: "Generate an AI-powered playlist from your Spotify history",
	},
	middleware: [Middleware.Cooldown(120), Middleware.VoteRequired()],
	async execute(ctx: CommandContext) {
		const redis = getRedis();
		const rlKey = `pai:rl:${ctx.user.id}`;
		const onCd = await redis.get(rlKey);
		if (onCd) {
			const ttl = await redis.ttl(rlKey);
			await ctx.reply({
				components: [
					errorContainer(
						"Cooldown",
						`You can generate a new playlist in **${ttl > 0 ? ttl : GEN_COOLDOWN}s**.`,
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const [limit, count] = await Promise.all([
			getPlaylistLimit(ctx.user.id),
			getUserPlaylistCount(ctx.user.id),
		]);

		if (count >= limit) {
			await ctx.reply({
				components: [
					errorContainer(
						"Limit Reached",
						`You have **${count}/${limit}** playlists. Delete one to continue.`,
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const [rawFavs, rawHistory] = await Promise.all([
			getFavourites(ctx.user.id).catch(() => []),
			getHistory(ctx.user.id).catch(() => []),
		]);

		const pool = buildPool(rawFavs, rawHistory);

		if (!pool.length) {
			await ctx.reply({
				components: [
					errorContainer(
						"No Spotify Tracks",
						"Like or listen to Spotify tracks to use AI playlist generation.",
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const state: State = {
			stage: "seed",
			page: 0,
			selected: [],
			generated: [],
			previewPage: 0,
			plName: await getNextAiName(ctx.user.id),
		};

		const msg = await ctx.reply({
			components: [buildSeedView(pool, state)],
			flags: MessageFlags.IsComponentsV2,
		});

		const collector = msg.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: COLLECTOR_TIME,
			filter: (i) => i.user.id === ctx.user.id,
		});

		const selectCollector = msg.createMessageComponentCollector({
			componentType: ComponentType.StringSelect,
			time: COLLECTOR_TIME,
			filter: (i) => i.user.id === ctx.user.id,
		});

		selectCollector.on("collect", async (i) => {
			if (i.customId !== "plai:seed") return;
			await i.deferUpdate();

			const totalPages = Math.ceil(pool.length / SEEDS_PER_PAGE);
			const page = Math.min(state.page, Math.max(0, totalPages - 1));
			const start = page * SEEDS_PER_PAGE;
			const end = Math.min(start + SEEDS_PER_PAGE, pool.length);
			const pageIds = pool.slice(start, end).map((t) => t.identifier);

			state.selected = state.selected.filter((id) => !pageIds.includes(id));
			for (const v of i.values) {
				if (state.selected.length < MAX_SEEDS && !state.selected.includes(v)) {
					state.selected.push(v);
				}
			}

			await msg.edit({ components: [buildSeedView(pool, state)] });
		});

		collector.on("collect", async (i) => {
			try {
				if (state.stage === "seed") {
					if (i.customId === "plai:prev") {
						await i.deferUpdate();
						state.page = Math.max(0, state.page - 1);
						await msg.edit({ components: [buildSeedView(pool, state)] });
						return;
					}

					if (i.customId === "plai:next") {
						await i.deferUpdate();
						const totalPages = Math.ceil(pool.length / SEEDS_PER_PAGE);
						state.page = Math.min(totalPages - 1, state.page + 1);
						await msg.edit({ components: [buildSeedView(pool, state)] });
						return;
					}

					if (i.customId === "plai:clear") {
						await i.deferUpdate();
						state.selected = [];
						await msg.edit({ components: [buildSeedView(pool, state)] });
						return;
					}

					if (i.customId === "plai:generate") {
						if (!state.selected.length) {
							await i.deferUpdate();
							return;
						}

						await i.deferUpdate();
						state.stage = "generating";
						await msg.edit({ components: [buildLoadingView(state.selected.length)] });

						await redis.set(rlKey, "1", "EX", GEN_COOLDOWN);
						const generated = await generate(state.selected);

						if (!generated.length) {
							await redis.del(rlKey);
							state.stage = "seed";
							await msg.edit({
								components: [
									errorContainer(
										"Generation Failed",
										"Could not get recommendations for your seeds. Try different tracks.",
									).addActionRowComponents(
										ActionRow().addComponents(primaryButton("Try Again", "plai:clear")),
									),
								],
							});
							return;
						}

						state.generated = generated;
						state.previewPage = 0;
						state.stage = "preview";
						await msg.edit({ components: [buildPreviewView(pool, state)] });
						return;
					}

					return;
				}

				if (state.stage === "preview") {
					if (i.customId === "plai:prev") {
						await i.deferUpdate();
						state.previewPage = Math.max(0, state.previewPage - 1);
						await msg.edit({ components: [buildPreviewView(pool, state)] });
						return;
					}

					if (i.customId === "plai:next") {
						await i.deferUpdate();
						const total = Math.ceil(state.generated.length / PREVIEW_PER_PAGE);
						state.previewPage = Math.min(total - 1, state.previewPage + 1);
						await msg.edit({ components: [buildPreviewView(pool, state)] });
						return;
					}

					if (i.customId.startsWith("plai:rm:")) {
						await i.deferUpdate();
						const idx = Number(i.customId.slice("plai:rm:".length));
						if (!Number.isNaN(idx) && idx >= 0 && idx < state.generated.length) {
							state.generated.splice(idx, 1);
							const total = Math.ceil(state.generated.length / PREVIEW_PER_PAGE);
							if (state.previewPage >= total && state.previewPage > 0) {
								state.previewPage = total - 1;
							}
						}

						if (!state.generated.length) {
							await msg.edit({
								components: [
									errorContainer(
										"No Tracks Left",
										"All tracks removed. Start over to regenerate.",
									).addActionRowComponents(
										ActionRow().addComponents(primaryButton("Start Over", "plai:regen")),
									),
								],
							});
							return;
						}

						await msg.edit({ components: [buildPreviewView(pool, state)] });
						return;
					}

					if (i.customId === "plai:rename") {
						await i.showModal(
							Modal(`plai:rename:${i.id}`, "Rename Playlist").addLabelComponents(
								Label(
									"Playlist Name",
									TextInput("plai:name", TextInputStyle.Short, true)
										.setValue(state.plName)
										.setMaxLength(100),
								),
							),
						);

						const submit = await i
							.awaitModalSubmit({
								filter: (s) => s.customId === `plai:rename:${i.id}` && s.user.id === ctx.user.id,
								time: 120_000,
							})
							.catch(() => null);

						if (!submit) return;
						await submit.deferUpdate();
						const name = submit.fields.getTextInputValue("plai:name").trim();
						if (name) state.plName = name;
						await msg.edit({ components: [buildPreviewView(pool, state)] });
						return;
					}

					if (i.customId === "plai:regen") {
						await i.deferUpdate();
						state.stage = "seed";
						state.selected = [];
						state.generated = [];
						state.previewPage = 0;
						state.page = 0;
						state.plName = await getNextAiName(ctx.user.id);
						await msg.edit({ components: [buildSeedView(pool, state)] });
						return;
					}

					if (i.customId === "plai:save") {
						await i.deferUpdate();

						const [freshLimit, freshCount] = await Promise.all([
							getPlaylistLimit(ctx.user.id),
							getUserPlaylistCount(ctx.user.id),
						]);

						if (freshCount >= freshLimit) {
							await msg.edit({
								components: [
									errorContainer(
										"Limit Reached",
										`You have **${freshCount}/${freshLimit}** playlists. Delete one first.`,
									),
								],
							});
							return;
						}

						const createResult = await createPlaylist(ctx.user.id, state.plName);

						if (!createResult.success) {
							const reasons: Record<string, string> = {
								DUPLICATE_NAME:
									"A playlist with that name already exists. Use Rename to change it.",
								LIMIT_REACHED: "Playlist limit reached.",
							};
							await msg.edit({
								components: [
									errorContainer(
										"Save Failed",
										reasons[createResult.error] || "Could not create playlist.",
									).addActionRowComponents(
										ActionRow().addComponents(primaryButton("Rename", "plai:rename")),
									),
								],
							});
							return;
						}

						const encoded = state.generated.map((t) => t.encoded).filter(Boolean);
						const addResult = await addTracks(createResult.data.id, ctx.user.id, encoded);

						collector.stop("saved");
						selectCollector.stop("saved");

						const saved = addResult.success ? addResult.data.added : encoded.length;
						const skipped = addResult.success ? addResult.data.skipped : 0;

						await msg.edit({
							components: [
								successContainer()
									.addTextDisplayComponents(TextDisplay("### Playlist Saved"))
									.addSeparatorComponents(Separator())
									.addTextDisplayComponents(
										TextDisplay(
											`**${sanitizeTitle(state.plName, 80)}**\n\`${createResult.data.id}\``,
										),
									)
									.addSeparatorComponents(Separator())
									.addTextDisplayComponents(
										TextDisplay(
											`-# ${saved} track${saved !== 1 ? "s" : ""} saved${skipped ? ` • ${skipped} skipped (track limit)` : ""} • ${freshCount + 1}/${freshLimit} playlists`,
										),
									),
							],
						});
						return;
					}
				}
			} catch {
				// noop
			}
		});

		collector.on("end", (_collected, reason) => {
			if (reason === "saved") return;
			selectCollector.stop();

			if (state.stage === "generating") return;

			const view =
				state.stage === "preview"
					? buildPreviewView(pool, state, true)
					: buildSeedView(pool, state, true);

			msg.edit({ components: [view] }).catch(() => undefined);
		});
	},
});

function buildSeedView(pool: SeedTrack[], state: State, disable: boolean = false) {
	const totalPages = Math.ceil(pool.length / SEEDS_PER_PAGE);
	const page = Math.min(state.page, Math.max(0, totalPages - 1));
	const start = page * SEEDS_PER_PAGE;
	const end = Math.min(start + SEEDS_PER_PAGE, pool.length);
	const pageTracks = pool.slice(start, end);
	const pageIds = pageTracks.map((t) => t.identifier);
	const selectedElsewhere = state.selected.filter((id) => !pageIds.includes(id));
	const remaining = MAX_SEEDS - selectedElsewhere.length;

	const container = defContainer()
		.addTextDisplayComponents(TextDisplay("### AI Playlist Generator"))
		.addSeparatorComponents(Separator());

	if (state.selected.length) {
		const lines = state.selected.map((id, idx) => {
			const track = pool.find((poolTrack) => poolTrack.identifier === id);
			const tag = track?.isFav ? "Fav" : "Hist";
			const offPage = pageIds.includes(id) ? "" : " *(other page)*";
			return track
				? `${tag} **${idx + 1}.** ${truncate(track.title, 38)} — ${truncate(track.author, 22)}${offPage}`
				: `**${idx + 1}.** Unknown`;
		});
		container.addTextDisplayComponents(
			TextDisplay(
				`**Selected Seeds (${state.selected.length}/${MAX_SEEDS})**\n${lines.join("\n")}`,
			),
		);
	} else {
		container.addTextDisplayComponents(
			TextDisplay(
				`-# Pick up to **${MAX_SEEDS}** Spotify tracks as seeds. The AI will generate **${TARGET} tracks** balanced across your seeds. Selections persist across pages.`,
			),
		);
	}

	container.addSeparatorComponents(Separator(false));

	const maxValues = remaining <= 0 ? 1 : Math.min(pageTracks.length, remaining);

	const seedSelect = SelectMenu(
		remaining <= 0
			? `${MAX_SEEDS}/${MAX_SEEDS} seeds selected`
			: `Tracks ${start + 1}-${end} of ${pool.length}`,
		pageTracks.map((t) => ({
			label: truncate(t.title, 85),
			description: truncate(`${t.author}${t.isFav ? " • Favorite" : " • History"}`, 100),
			value: t.identifier,
			default: state.selected.includes(t.identifier),
		})),
		"plai:seed",
		0,
		maxValues,
	);
	seedSelect.setDisabled(disable);

	container.addActionRowComponents(ActionRow().addComponents(seedSelect));

	const navRow = ActionRow();

	if (totalPages > 1) {
		navRow.addComponents(
			secondaryButton("prev", "plai:prev", disable || page === 0),
			secondaryButton("next", "plai:next", disable || page >= totalPages - 1),
		);
	}

	if (state.selected.length > 0) {
		navRow.addComponents(dangerButton("Clear All", "plai:clear", disable));
	}

	navRow.addComponents(
		primaryButton("Generate", "plai:generate", disable || state.selected.length === 0),
	);

	container.addActionRowComponents(navRow);
	container.addTextDisplayComponents(
		TextDisplay(
			`-# ${pool.length} Spotify tracks available • Page ${page + 1}/${totalPages}${totalPages > 1 ? " • selections persist across pages" : ""}`,
		),
	);

	return container;
}

function buildLoadingView(seedCount: number) {
	return defContainer().addTextDisplayComponents(
		TextDisplay(
			`### Generating...\n\n-# Generating playlist from **${seedCount}** seed${seedCount !== 1 ? "s" : ""}, targeting **${TARGET} tracks**`,
		),
	);
}

function buildPreviewView(pool: SeedTrack[], state: State, disable: boolean = false) {
	const { generated, previewPage, plName, selected } = state;
	const totalPages = Math.ceil(generated.length / PREVIEW_PER_PAGE);
	const page = Math.min(previewPage, Math.max(0, totalPages - 1));
	const start = page * PREVIEW_PER_PAGE;
	const end = Math.min(start + PREVIEW_PER_PAGE, generated.length);

	const container = defContainer()
		.addTextDisplayComponents(TextDisplay(`### ${sanitizeTitle(plName, 60)}`))
		.addSeparatorComponents(Separator());

	const seedSummary = selected
		.map((id) => {
			const seedTrack = pool.find((poolTrack) => poolTrack.identifier === id);
			return seedTrack ? truncate(seedTrack.title, 22) : "Unknown";
		})
		.join(", ");

	container.addTextDisplayComponents(TextDisplay(`-# Seeds: ${seedSummary}`));
	container.addSeparatorComponents(Separator());

	for (let i = start; i < end; i++) {
		const track = generated[i];
		if (!track) continue;
		const dur = track.duration ? TrackDecoder.formatDuration(track.duration) : "0:00";
		const safeTitle = sanitizeTitle(track.title, 45);
		const content = track.uri
			? `**[${safeTitle}](${track.uri})**\n-# ${truncate(track.author, 35)} • ${dur}`
			: `**${safeTitle}**\n-# ${truncate(track.author, 35)} • ${dur}`;

		const section = baseSection().addTextDisplayComponents(TextDisplay(content));
		section.setButtonAccessory(dangerButton("Remove", `plai:rm:${i}`, disable));
		container.addSectionComponents(section);

		if (i < end - 1) container.addSeparatorComponents(Separator(false));
	}

	container.addSeparatorComponents(Separator());

	const actionRow = ActionRow();

	if (totalPages > 1) {
		actionRow.addComponents(
			secondaryButton("prev", "plai:prev", disable || page === 0),
			secondaryButton("next", "plai:next", disable || page >= totalPages - 1),
		);
	}

	actionRow.addComponents(
		secondaryButton("Rename", "plai:rename", disable),
		secondaryButton("Start Over", "plai:regen", disable),
		primaryButton("Save", "plai:save", disable || !generated.length),
	);

	container.addActionRowComponents(actionRow);
	container.addTextDisplayComponents(
		TextDisplay(
			`-# ${generated.length} track${generated.length !== 1 ? "s" : ""}${totalPages > 1 ? ` • Page ${page + 1}/${totalPages}` : ""}`,
		),
	);

	return container;
}
