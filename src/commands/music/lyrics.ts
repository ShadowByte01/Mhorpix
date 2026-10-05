import { MessageFlags } from "discord.js";
import { getRedis } from "../../db/redis.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import type { QueueTrack } from "../../structures/music/index.js";
import { defineCommand } from "../../types/index.js";
import {
	ActionRow,
	defContainer,
	errorContainer,
	Separator,
	secondaryButton,
	TextDisplay,
} from "../../utils/components.js";

interface LyricsResult {
	readonly plain: string | null;
	readonly synced: string | null;
	readonly source: string;
}

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

class LyricsFetcher {
	private readonly requestTimeout: number;
	private readonly musixmatchGuid: string;
	private musixmatchToken: string | null = null;
	private musixmatchTokenExpiry = 0;
	private deezerJwt: string | null = null;
	private deezerJwtExpiry = 0;

	public constructor(requestTimeout = 8000) {
		this.requestTimeout = requestTimeout;
		this.musixmatchGuid = this.generateGuid();
	}

	private generateGuid(): string {
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (matchChar) => {
			const randomValue = (Math.random() * 16) | 0;
			return (matchChar === "x" ? randomValue : (randomValue & 0x3) | 0x8).toString(16);
		});
	}

	private syncedToPlain(synced: string | null): string | null {
		if (!synced) return null;
		return synced
			.split("\n")
			.map((line) => line.replace(/\[\d{1,2}:\d{2}\.\d{2,3}\]\s*/g, "").trim())
			.filter(Boolean)
			.join("\n");
	}

	private cleanText(text: string): string {
		const patterns = [
			/\s*\([^)]*(?:official|lyrics?|video|audio|mv|visualizer|color\s*coded|hd|4k|prod\.)[^)]*\)/gi,
			/\s*\[[^\]]*(?:official|lyrics?|video|audio|mv|visualizer|color\s*coded|hd|4k|prod\.)[^\]]*\]/gi,
			/\s*-\s*Topic$/i,
			/VEVO$/i,
		];
		return patterns.reduce((result, pattern) => result.replace(pattern, ""), text).trim();
	}

	private formatLrcTime(milliseconds: number): string {
		const minutes = Math.floor(milliseconds / 60000);
		const seconds = Math.floor((milliseconds % 60000) / 1000);
		const hundredths = Math.floor((milliseconds % 1000) / 10);
		return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}]`;
	}

	private async getMusixmatchToken(): Promise<string | null> {
		if (this.musixmatchToken && Date.now() < this.musixmatchTokenExpiry)
			return this.musixmatchToken;

		const redis = getRedis();
		const cached = await redis.get("lyrics:mxm:token");
		if (cached) {
			this.musixmatchToken = cached;
			this.musixmatchTokenExpiry = Date.now() + 55_000;
			return cached;
		}

		try {
			const response = await fetch(
				"https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0",
				{
					headers: { accept: "*/*", "user-agent": USER_AGENT },
					signal: AbortSignal.timeout(this.requestTimeout),
				},
			);
			if (!response.ok) return null;

			const data = (await response.json()) as { message?: { body?: { user_token?: string } } };
			const token = data?.message?.body?.user_token;
			if (!token) return null;

			this.musixmatchToken = token;
			this.musixmatchTokenExpiry = Date.now() + 55_000;
			await redis.setex("lyrics:mxm:token", 55, token);
			return token;
		} catch {
			return null;
		}
	}

	private async musixmatchRequest(
		endpoint: string,
		params: Record<string, string>,
	): Promise<Record<string, unknown> | null> {
		const token = await this.getMusixmatchToken();
		if (!token) return null;

		try {
			const searchParams = new URLSearchParams({
				...params,
				app_id: "web-desktop-app-v1.0",
				usertoken: token,
				guid: this.musixmatchGuid,
			});

			const response = await fetch(`${endpoint}?${searchParams.toString()}`, {
				headers: { accept: "application/json", "user-agent": USER_AGENT },
				signal: AbortSignal.timeout(this.requestTimeout),
			});
			if (!response.ok) return null;

			const data = (await response.json()) as { message?: { body?: Record<string, unknown> } };
			return data?.message?.body ?? null;
		} catch {
			return null;
		}
	}

	private async fetchMusixmatch(artist: string, song: string): Promise<LyricsResult | null> {
		try {
			const searchBody = await this.musixmatchRequest(
				"https://apic-desktop.musixmatch.com/ws/1.1/track.search",
				{ q_artist: artist, q_track: song, page_size: "3", page: "1", s_track_rating: "desc" },
			);

			const track = (searchBody as { track_list?: Array<{ track?: { track_id?: string } }> } | null)
				?.track_list?.[0]?.track;
			if (!track?.track_id) return null;

			const trackId = track.track_id;
			const [subtitlesBody, lyricsBody] = await Promise.all([
				this.musixmatchRequest("https://apic-desktop.musixmatch.com/ws/1.1/track.subtitle.get", {
					track_id: trackId,
					subtitle_format: "mxm",
				}),
				this.musixmatchRequest("https://apic-desktop.musixmatch.com/ws/1.1/track.lyrics.get", {
					track_id: trackId,
				}),
			]);

			const subBody = (subtitlesBody as { subtitle?: { subtitle_body?: string } } | null)?.subtitle
				?.subtitle_body;
			if (subBody) {
				const parsed = JSON.parse(subBody) as Array<{ time?: { total?: number }; text?: string }>;
				if (Array.isArray(parsed) && parsed.length > 0) {
					const lrcLines = parsed.map((item) => {
						const time = Math.round((item?.time?.total ?? 0) * 1000);
						return `${this.formatLrcTime(time)} ${item?.text ?? ""}`;
					});
					const synced = lrcLines.join("\n");
					return { synced, plain: this.syncedToPlain(synced), source: "musixmatch" };
				}
			}

			const plainLyrics = (lyricsBody as { lyrics?: { lyrics_body?: string } } | null)?.lyrics
				?.lyrics_body;
			if (plainLyrics) return { synced: null, plain: plainLyrics, source: "musixmatch" };

			return null;
		} catch {
			return null;
		}
	}

	private async getDeezerJwt(): Promise<string | null> {
		if (this.deezerJwt && Date.now() < this.deezerJwtExpiry) return this.deezerJwt;

		const redis = getRedis();
		const cached = await redis.get("lyrics:deezer:jwt");
		if (cached) {
			this.deezerJwt = cached;
			this.deezerJwtExpiry = Date.now() + 300_000;
			return cached;
		}

		try {
			const response = await fetch("https://auth.deezer.com/login/anonymous?jo=p&rto=c", {
				signal: AbortSignal.timeout(this.requestTimeout),
			});
			if (!response.ok) return null;

			const data = (await response.json()) as { jwt?: string };
			if (!data?.jwt) return null;

			this.deezerJwt = data.jwt;
			this.deezerJwtExpiry = Date.now() + 300_000;
			await redis.setex("lyrics:deezer:jwt", 300, data.jwt);
			return data.jwt;
		} catch {
			return null;
		}
	}

	private async fetchDeezer(artist: string, song: string): Promise<LyricsResult | null> {
		try {
			const jwt = await this.getDeezerJwt();
			if (!jwt) return null;

			const searchResponse = await fetch(
				`https://api.deezer.com/search?${new URLSearchParams({ q: `${artist} ${song}` })}`,
				{ signal: AbortSignal.timeout(this.requestTimeout) },
			);
			if (!searchResponse.ok) return null;

			const searchData = (await searchResponse.json()) as { data?: Array<{ id?: number }> };
			const trackId = searchData?.data?.[0]?.id;
			if (!trackId) return null;

			const lyricsResponse = await fetch("https://pipe.deezer.com/api", {
				method: "POST",
				headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
				body: JSON.stringify({
					operationName: "GetLyrics",
					variables: { trackId: String(trackId) },
					query: `query GetLyrics($trackId: String!) {
						track(trackId: $trackId) {
							lyrics {
								synchronizedWordByWordLines { start end words { word } }
								synchronizedLines { milliseconds duration line }
								text
							}
						}
					}`,
				}),
				signal: AbortSignal.timeout(this.requestTimeout),
			});
			if (!lyricsResponse.ok) return null;

			const data = (await lyricsResponse.json()) as {
				data?: {
					track?: {
						lyrics?: {
							synchronizedWordByWordLines?: Array<{
								start: number;
								words: Array<{ word: string }>;
							}>;
							synchronizedLines?: Array<{ milliseconds: number; line: string }>;
							text?: string;
						};
					};
				};
			};
			const lyrics = data?.data?.track?.lyrics;
			if (!lyrics) return null;

			if (lyrics.synchronizedWordByWordLines?.length) {
				const lrcLines = lyrics.synchronizedWordByWordLines.map((line) => {
					const text = line.words.map((w) => w.word).join(" ");
					return `${this.formatLrcTime(line.start)} ${text}`;
				});
				const synced = lrcLines.join("\n");
				return { synced, plain: this.syncedToPlain(synced), source: "deezer" };
			}

			if (lyrics.synchronizedLines?.length) {
				const lrcLines = lyrics.synchronizedLines.map(
					(line) => `${this.formatLrcTime(line.milliseconds)} ${line.line}`,
				);
				const synced = lrcLines.join("\n");
				return { synced, plain: this.syncedToPlain(synced), source: "deezer" };
			}

			if (lyrics.text) return { synced: null, plain: lyrics.text, source: "deezer" };

			return null;
		} catch {
			return null;
		}
	}

	private async fetchLrclib(artist: string, song: string): Promise<LyricsResult | null> {
		try {
			const params = new URLSearchParams({ track_name: song, artist_name: artist });
			const response = await fetch(`https://lrclib.net/api/get?${params}`, {
				signal: AbortSignal.timeout(this.requestTimeout),
			});
			if (!response.ok) return null;

			const data = (await response.json()) as { syncedLyrics?: string; plainLyrics?: string };
			if (!data.syncedLyrics && !data.plainLyrics) return null;

			return {
				synced: data.syncedLyrics ?? null,
				plain:
					data.plainLyrics ?? (data.syncedLyrics ? this.syncedToPlain(data.syncedLyrics) : null),
				source: "lrclib",
			};
		} catch {
			return null;
		}
	}

	private async fetchGenius(artist: string, song: string): Promise<LyricsResult | null> {
		try {
			const searchUrl = `https://genius.com/api/search/multi?q=${encodeURIComponent(`${song} ${artist}`)}`;
			const searchResponse = await fetch(searchUrl, {
				headers: { "user-agent": USER_AGENT },
				signal: AbortSignal.timeout(this.requestTimeout),
			});
			if (!searchResponse.ok) return null;

			const searchData = (await searchResponse.json()) as {
				response?: {
					sections?: Array<{ type: string; hits?: Array<{ result?: { path?: string } }> }>;
				};
			};
			const songResult = searchData.response?.sections?.find((s) => s.type === "song")?.hits?.[0]
				?.result;
			if (!songResult?.path) return null;

			const pageResponse = await fetch(`https://genius.com${songResult.path}`, {
				headers: { "user-agent": USER_AGENT },
				signal: AbortSignal.timeout(this.requestTimeout),
			});
			if (!pageResponse.ok) return null;

			const html = await pageResponse.text();
			const stateMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*JSON\.parse\('(.*)'\);/);
			if (!stateMatch?.[1]) return null;

			const stateJson = JSON.parse(stateMatch[1].replace(/\\(.)/g, "$1")) as {
				songPage?: { lyricsData?: { body?: { html?: string } } };
			};
			const lyricsHtml = stateJson.songPage?.lyricsData?.body?.html;
			if (!lyricsHtml) return null;

			const plainText = lyricsHtml
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]*>/g, "")
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
				.join("\n");
			if (!plainText) return null;

			return { synced: null, plain: plainText, source: "genius" };
		} catch {
			return null;
		}
	}

	private async firstMatching(
		sources: Array<() => Promise<LyricsResult | null>>,
		predicate: (result: LyricsResult | null) => boolean,
	): Promise<LyricsResult | null> {
		if (sources.length === 0) return null;
		const [source, ...rest] = sources as [
			() => Promise<LyricsResult | null>,
			...Array<() => Promise<LyricsResult | null>>,
		];
		const result = await source();
		if (predicate(result)) return result;
		return this.firstMatching(rest, predicate);
	}

	public async getLyrics(
		artist: string,
		song: string,
		plainOnly = false,
	): Promise<LyricsResult | null> {
		const cleanArtist = this.cleanText(artist);
		const cleanSong = this.cleanText(song);
		const cacheKey = `lyrics:${cleanArtist}:${cleanSong}`;
		const redis = getRedis();

		const cached = await redis.get(cacheKey);
		if (cached) {
			const parsed = JSON.parse(cached) as LyricsResult;
			if (plainOnly && !parsed.plain) return null;
			return plainOnly ? { plain: parsed.plain, synced: null, source: parsed.source } : parsed;
		}

		const syncedSources = [
			() => this.fetchLrclib(cleanArtist, cleanSong),
			() => this.fetchMusixmatch(cleanArtist, cleanSong),
			() => this.fetchDeezer(cleanArtist, cleanSong),
		];

		const syncedResult = await this.firstMatching(syncedSources, (r) => !!r?.synced);
		if (syncedResult) {
			await redis.setex(cacheKey, 86_400, JSON.stringify(syncedResult));
			return plainOnly
				? { plain: syncedResult.plain, synced: null, source: syncedResult.source }
				: syncedResult;
		}

		const plainSources = [...syncedSources, () => this.fetchGenius(cleanArtist, cleanSong)];

		const plainResult = await this.firstMatching(plainSources, (r) => !!r?.plain);
		if (plainResult) {
			await redis.setex(cacheKey, 86_400, JSON.stringify(plainResult));
			return plainOnly
				? { plain: plainResult.plain, synced: null, source: plainResult.source }
				: plainResult;
		}

		return null;
	}
}

const fetcher = new LyricsFetcher();
const LINES_PER_PAGE = 20;

function buildLyricsContainer(plain: string, track: QueueTrack, page: number, disabled = false) {
	const sanitized = plain.replace(/\*/g, "●");
	const lines = sanitized.split("\n").filter((l) => l.trim());
	const totalPages = Math.max(1, Math.ceil(lines.length / LINES_PER_PAGE));
	const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
	const start = clampedPage * LINES_PER_PAGE;
	const pageLines = lines.slice(start, start + LINES_PER_PAGE);

	const container = defContainer()
		.addTextDisplayComponents(TextDisplay("### Lyrics"))
		.addSeparatorComponents(Separator())
		.addTextDisplayComponents(
			TextDisplay(
				`### ${track.info.title}\n-# ${track.info.author}\n\n>>> ${pageLines.join("\n")}`,
			),
		)
		.addTextDisplayComponents(TextDisplay(`-# Page ${clampedPage + 1}/${totalPages}`));

	if (totalPages > 1) {
		container
			.addSeparatorComponents(Separator())
			.addActionRowComponents(
				ActionRow().addComponents(
					secondaryButton("Previous", "lyrics_prev", disabled || clampedPage === 0),
					secondaryButton("Next", "lyrics_next", disabled || clampedPage === totalPages - 1),
				),
			);
	}

	return { container, totalPages, page: clampedPage };
}

export default defineCommand({
	name: "lyrics",
	aliases: ["ly"],
	description: "View lyrics for the current track",
	category: "music",
	enabledSlash: true,
	slashData: {
		name: "lyrics",
		description: "View lyrics for the current track",
	},
	middleware: [
		Middleware.Cooldown(30),
		Middleware.GuildOnly(),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.PlayerCheck("playing"),
	],
	async execute(ctx: CommandContext) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		const track = player?.currentTrack;

		if (!player || !track) {
			await ctx.reply({
				components: [errorContainer("No Track Playing", "Start playing a track to view lyrics.")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		await ctx.reply({
			components: [
				defContainer().addTextDisplayComponents(
					TextDisplay(
						`## Searching lyrics for\n[**${track.info.title}**](${track.info.uri})\n-# ${track.info.author}`,
					),
				),
			],
			flags: MessageFlags.IsComponentsV2,
		});

		const lyricsData = await fetcher.getLyrics(track.info.author, track.info.title, true);

		if (!lyricsData?.plain) {
			await ctx.editReply({
				components: [
					errorContainer("No Lyrics Found", `Lyrics not available for **${track.info.title}**.`),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const plain = lyricsData.plain;
		let page = 0;

		const { container } = buildLyricsContainer(plain, track, page);

		const message = await ctx.editReply({
			components: [container],
			flags: MessageFlags.IsComponentsV2,
		});

		const collector = message.createMessageComponentCollector({
			time: 300_000,
			filter: (i) => {
				if (i.user.id !== ctx.user.id) {
					i.reply({
						content: "This isn't your lyrics session.",
						flags: MessageFlags.Ephemeral,
					});
					return false;
				}
				return true;
			},
		});

		collector.on("collect", async (interaction) => {
			await interaction.deferUpdate().catch(() => {
				// empty because intentionally ignoring errors from deferUpdate
			});
			page = interaction.customId === "lyrics_next" ? page + 1 : page - 1;
			const { container: updated } = buildLyricsContainer(plain, track, page);
			await message
				.edit({ components: [updated], flags: MessageFlags.IsComponentsV2 })
				.catch(() => {
					/** empty because errors can be safely ignored */
				});
		});

		collector.on("end", async () => {
			const { container: ended } = buildLyricsContainer(plain, track, page, true);
			await message.edit({ components: [ended], flags: MessageFlags.IsComponentsV2 }).catch(() => {
				// empty because errors are intentionally ignored
			});
		});
	},
});
