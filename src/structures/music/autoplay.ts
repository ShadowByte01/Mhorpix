import { logger } from "../../utils/logger.js";
import type { Manager } from "./Manager.js";
import type { Player } from "./Player.js";
import type { PartialQueueTrack, QueueTrack, TrackRequester } from "./types.js";
import { SearchSource } from "./types.js";

const REC_API = "https://sp-pl-bread.vercel.app/api/2";
const LIMIT = 2;
const REC_POOL_SIZE = 10;
const YT_POOL_SIZE = 6;
const SEED_CONFIDENCE_THRESHOLD = 0.55;

const DEMOCRATIC_MIN_REQUESTERS = 2;
const DEMOCRATIC_MAX_REQUESTERS = 5;

interface ApiTrackInfo {
	identifier: string;
	isSeekable: boolean;
	author: string;
	duration?: number;
	length?: number;
	isStream: boolean;
	position: number;
	title: string;
	uri: string;
	artworkUrl: string | null;
	isrc: string | null;
	sourceName: string;
	[key: string]: unknown;
}

interface ApiTrack {
	encoded: string;
	info: ApiTrackInfo;
	pluginInfo: Record<string, unknown>;
	userData?: Record<string, unknown>;
}

interface RecommendationResponse {
	loadType: string;
	data: {
		tracks: ApiTrack[];
	};
}

interface PlayedTrack {
	identifier: string;
	title: string;
	artist: string;
	length: number;
	duration: number;
	isrc: string | null;
}

const normalize = (s: string | null | undefined): string =>
	(s ?? "")
		.toLowerCase()
		.replace(/[[(].+?[)\]]/g, "")
		.replace(/ft\.|feat\.|featuring|vs\.?|x\s+/gi, " ")
		.replace(/[^a-z0-9\s]/g, "")
		.replace(/\s+/g, " ")
		.trim();

const levenshtein = (a: string, b: string, cap = Number.POSITIVE_INFINITY): number => {
	const la = a.length;
	const lb = b.length;
	if (Math.abs(la - lb) > cap) return cap + 1;
	let prev = Array.from({ length: la + 1 }, (_, i) => i);
	let curr = new Array<number>(la + 1).fill(0);
	for (let j = 1; j <= lb; j++) {
		curr[0] = j;
		let rowMin = j;
		for (let i = 1; i <= la; i++) {
			const del = (curr[i - 1] ?? 0) + 1;
			const ins = (prev[i] as number) + 1;
			const sub = (prev[i - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
			const val = Math.min(del, ins, sub);
			curr[i] = val;
			if (val < rowMin) rowMin = val;
		}
		if (rowMin > cap) return cap + 1;
		[prev, curr] = [curr, prev];
	}
	return prev[la] ?? 0;
};

const sim = (a: string, b: string): number => {
	if (!a || !b) return 0;
	const na = normalize(a);
	const nb = normalize(b);
	if (na === nb) return 1;
	const max = Math.max(na.length, nb.length);
	return max === 0 ? 1 : 1 - levenshtein(na, nb, max) / max;
};

const tokens = (s: string | null | undefined): string[] =>
	normalize(s)
		.split(" ")
		.filter((w) => w.length > 2);

const bagSim = (bagA: string, bagB: string): number => {
	const wa = new Set(tokens(bagA));
	const wb = new Set(tokens(bagB));
	if (!wa.size || !wb.size) return 0;
	let hits = 0;
	for (const w of wa) if (wb.has(w)) hits++;
	const precision = hits / wa.size;
	const recall = hits / wb.size;
	return precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
};

const seedConfidence = (
	candidate: PartialQueueTrack,
	refBag: string,
	refDurationMs: number,
): number => {
	const candBag = `${candidate.info.title} ${candidate.info.author}`;
	const bag = bagSim(refBag, candBag);
	const candDur = candidate.info.length ?? 0;
	const durScore =
		refDurationMs && candDur ? Math.max(0, 1 - Math.abs(candDur - refDurationMs) / 30000) : 0.5;
	return Math.min(1, bag * 0.85 + durScore * 0.15);
};

const buildDuplicateChecker = (played: PlayedTrack[]) => {
	const words = (s: string) => s.split(" ").filter((w) => w.length > 2);

	const overlap = (w1: string[], w2: string[]): number => {
		if (!w1.length || !w2.length) return 0;
		return w1.filter((w) => w2.includes(w)).length / Math.min(w1.length, w2.length);
	};

	return (
		identifier: string,
		title: string,
		artist: string,
		duration: number,
		isrc: string | null | undefined,
	): boolean => {
		const nt = normalize(title);
		const na = normalize(artist);
		if (!nt || !na) return true;

		for (const p of played) {
			if (identifier && p.identifier === identifier) return true;
			if (isrc && p.isrc && isrc === p.isrc) return true;

			const pd = p.length ?? p.duration ?? 0;
			const dd = Math.abs(duration - pd);
			const nw = words(nt);
			const pw = words(p.title);

			if (nt === p.title && na === p.artist) return true;

			if (na === p.artist) {
				if (sim(nt, p.title) >= 0.85 && dd <= 25000) return true;
				if (overlap(nw, pw) >= 0.7 && dd <= 20000) return true;
				if (
					nt.length >= 4 &&
					p.title.length >= 4 &&
					(nt.includes(p.title) || p.title.includes(nt)) &&
					dd <= 18000
				)
					return true;
			}

			if (sim(nt, p.title) >= 0.9 && dd <= 12000) return true;
			const ov = overlap(nw, pw);
			if (nw.length >= 2 && ov >= 0.8 && dd <= 10000) return true;
			if (nw.length <= 2 && pw.length <= 2 && ov === 1.0 && dd <= 8000) return true;
			if (nt.length >= 8 && p.title.length >= 8) {
				const [longer, shorter] = nt.length > p.title.length ? [nt, p.title] : [p.title, nt];
				if (longer.includes(shorter) && shorter.length / longer.length >= 0.75 && dd <= 12000)
					return true;
			}
		}
		return false;
	};
};

const shuffle = <T>(arr: T[]): T[] => {
	const shuffledArray = [...arr];
	for (let i = shuffledArray.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const temp = shuffledArray[i] as T;
		shuffledArray[i] = shuffledArray[j] as T;
		shuffledArray[j] = temp;
	}
	return shuffledArray;
};

const fetchRecs = async (spotifyId: string): Promise<PartialQueueTrack[] | null> => {
	logger.debug("Autoplay", `fetchRecs: seed=[${spotifyId}]`);
	try {
		const res = await fetch(`${REC_API}?endpoint=recommendations&id=${spotifyId}&limit=100`);
		if (!res.ok) {
			logger.debug("Autoplay", `fetchRecs: HTTP ${res.status} for [${spotifyId}]`);
			return null;
		}
		const json = (await res.json()) as RecommendationResponse;
		const tracks = json?.data?.tracks ?? null;
		logger.debug("Autoplay", `fetchRecs: got ${tracks?.length ?? 0} tracks for [${spotifyId}]`);

		if (!tracks) return null;

		return tracks.map((t) => {
			const dur = t.info.length ?? t.info.duration ?? 0;
			return {
				encoded: t.encoded,
				info: { ...t.info, length: dur } as QueueTrack["info"],
				pluginInfo: t.pluginInfo ?? {},
			};
		});
	} catch (e) {
		logger.debug("Autoplay", `fetchRecs: error for [${spotifyId}]: ${(e as Error).message}`);
		return null;
	}
};

const findSpotifySeed = async (
	manager: Manager,
	rawTitle: string,
	rawAuthor: string,
	durationMs: number,
): Promise<{ id: string; confidence: number } | null> => {
	const refBag = `${rawTitle} ${rawAuthor}`;
	const firstPipe = rawTitle.split("|")[0]?.trim() ?? rawTitle;
	const searchQ = `${firstPipe} ${rawAuthor}`.trim();

	logger.debug("Autoplay", `findSpotifySeed: refBag="${refBag}"`);
	logger.debug("Autoplay", `findSpotifySeed: searchQ="${searchQ}"`);

	const res = await manager.search(searchQ, SearchSource.Spotify);
	if (!res?.tracks?.length) {
		logger.debug("Autoplay", `findSpotifySeed: no results for "${searchQ}"`);
		return null;
	}

	let bestId: string | null = null;
	let bestConf = 0;

	for (const t of res.tracks.slice(0, 10)) {
		if (!t?.info) continue;
		const conf = seedConfidence(t, refBag, durationMs);
		logger.debug(
			"Autoplay",
			`findSpotifySeed: candidate "${t.info.title}" by "${t.info.author}" conf=${conf.toFixed(3)}`,
		);
		if (conf > bestConf) {
			bestConf = conf;
			bestId = t.info.identifier;
		}
		if (bestConf >= 0.95) break;
	}

	if (!bestId) return null;
	logger.debug("Autoplay", `findSpotifySeed: best=[${bestId}] conf=${bestConf.toFixed(3)}`);
	return { id: bestId, confidence: bestConf };
};

const YT_ID_RE = /[?&]v=([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})/;

const resolveYtVideoId = async (
	manager: Manager,
	title: string,
	artist: string,
): Promise<string | null> => {
	for (const source of [SearchSource.YouTubeMusic, SearchSource.YouTube] as const) {
		// biome-ignore lint/performance/noAwaitInLoops: sequential search with early exit
		const res = await manager.search(`${title} ${artist}`, source);
		if (!res?.tracks?.length) continue;
		const top = res.tracks[0];
		if (!top) continue;
		const uri = top.info.uri ?? "";
		const matchResult = uri.match(YT_ID_RE);
		const id = matchResult?.[1] ?? matchResult?.[2] ?? top.info.identifier;
		if (id) {
			logger.debug("Autoplay", `resolveYtVideoId: [${id}] "${top.info.title}" via ${source}`);
			return id;
		}
	}
	return null;
};

const fetchYtMixTracks = async (
	manager: Manager,
	videoId: string,
): Promise<PartialQueueTrack[] | null> => {
	const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
	logger.debug("Autoplay", `fetchYtMixTracks: loading ${mixUrl}`);
	try {
		const res = await manager.search(mixUrl, SearchSource.Direct);
		if (!res?.tracks?.length) {
			logger.debug("Autoplay", `fetchYtMixTracks: no tracks for [${videoId}]`);
			return null;
		}
		logger.debug("Autoplay", `fetchYtMixTracks: ${res.tracks.length} tracks for [${videoId}]`);
		return res.tracks;
	} catch (e) {
		logger.debug("Autoplay", `fetchYtMixTracks: error for [${videoId}]: ${(e as Error).message}`);
		return null;
	}
};

const pickRandom = (
	tracks: PartialQueueTrack[],
	isDuplicate: (
		identifier: string,
		title: string,
		artist: string,
		duration: number,
		isrc: string | null | undefined,
	) => boolean,
	played: PlayedTrack[],
	poolSize: number,
	needed: number,
): PartialQueueTrack[] => {
	const pool: PartialQueueTrack[] = [];

	for (const track of tracks) {
		if (pool.length >= poolSize) break;
		if (!track?.info?.identifier) continue;

		const { identifier, title, author } = track.info;
		const duration = track.info.length ?? 0;

		if (isDuplicate(identifier, title ?? "", author ?? "", duration, track.info.isrc)) {
			logger.debug("Autoplay", `pickRandom: skip duplicate "${title}"`);
			continue;
		}

		logger.debug("Autoplay", `pickRandom: pool candidate "${title}" by "${author}"`);
		pool.push(track);
	}

	logger.debug("Autoplay", `pickRandom: pool=${pool.length} picking up to ${needed}`);

	const picked = shuffle(pool).slice(0, needed);

	for (const track of picked) {
		played.push({
			identifier: track.info.identifier,
			title: normalize(track.info.title),
			artist: normalize(track.info.author),
			length: track.info.length ?? 0,
			duration: track.info.length ?? 0,
			isrc: track.info.isrc ?? null,
		});
	}

	return picked;
};

const queueTracks = (
	player: Player,
	tracks: PartialQueueTrack[],
	extraPluginData: Record<string, unknown> = {},
	requester: TrackRequester,
): void => {
	const toAdd: QueueTrack[] = tracks.map((track) => {
		const duration = track.info.length ?? 0;
		return {
			encoded: track.encoded,
			info: { ...track.info, length: duration } as QueueTrack["info"],
			pluginInfo: {
				...(track.pluginInfo || {}),
				clientData: {
					...(track.pluginInfo?.clientData || {}),
					fromAutoplay: true,
					...extraPluginData,
				},
			},
			requester,
			addedAt: Date.now(),
		};
	});

	player.add(toAdd);
};

interface ResolvedSeed {
	seedId: string | null;
	confidence: number;
}

const resolveSeedForTrack = async (manager: Manager, track: QueueTrack): Promise<ResolvedSeed> => {
	if (track.info.sourceName === "spotify") {
		logger.debug("Autoplay", `seed: spotify direct [${track.info.identifier}]`);
		return { seedId: track.info.identifier, confidence: 1.0 };
	}

	logger.debug("Autoplay", `seed: non-spotify source (${track.info.sourceName}), resolving`);

	const rawTitle = track.info.title;
	const rawAuthor = track.info.author
		.replace(/\s*-\s*topic/gi, "")
		.replace(/vevo$/gi, "")
		.trim();

	const found = await findSpotifySeed(manager, rawTitle, rawAuthor, track.info.length);
	if (!found) return { seedId: null, confidence: 0 };
	return { seedId: found.id, confidence: found.confidence };
};

const cleanForYt = (track: QueueTrack): { title: string; author: string } => ({
	title: ((track.info.title ?? "").split("|")[0] ?? "")
		.replace(/[[(].*?[)\]]/g, "")
		.replace(/ft\.|feat\.|featuring|vs\.?/gi, "")
		.trim(),
	author: track.info.author
		.replace(/\s*-\s*topic/gi, "")
		.replace(/vevo$/gi, "")
		.trim(),
});

const registerPlayed = (played: PlayedTrack[], t: QueueTrack): void => {
	if (!t?.info?.identifier) return;
	played.push({
		identifier: t.info.identifier,
		title: normalize(t.info.title),
		artist: normalize(t.info.author),
		length: t.info.length,
		duration: t.info.length,
		isrc: t.info.isrc ?? null,
	});
};

async function runSingleSeedAutoplay(
	player: Player,
	manager: Manager,
	lastTrack: QueueTrack,
	isDuplicate: ReturnType<typeof buildDuplicateChecker>,
	played: PlayedTrack[],
	needed: number,
): Promise<number> {
	const { seedId, confidence } = await resolveSeedForTrack(manager, lastTrack);
	const seedIsReliable = confidence >= SEED_CONFIDENCE_THRESHOLD;
	logger.debug(
		"Autoplay",
		`seed: [${seedId ?? "none"}] conf=${confidence.toFixed(3)} reliable=${seedIsReliable}`,
	);

	let added = 0;

	if (seedId) {
		const recTracks = await fetchRecs(seedId);
		if (recTracks?.length) {
			const picked = pickRandom(recTracks, isDuplicate, played, REC_POOL_SIZE, needed - added);
			queueTracks(player, picked, {}, lastTrack.requester);
			added += picked.length;
			logger.debug("Autoplay", `primary seed: added ${added}/${needed}`);
		} else {
			logger.debug("Autoplay", `primary seed: no recs for [${seedId}]`);
		}

		if (added < needed) {
			const fallbackSeeds = player.queue
				.getHistory()
				.filter(
					(t) =>
						t?.info?.sourceName === "spotify" && t.info.identifier && t.info.identifier !== seedId,
				)
				.slice(-5)
				.reverse();

			logger.debug(
				"Autoplay",
				`fallback seeds: ${fallbackSeeds.length} candidates for ${needed - added} slots`,
			);

			for (const t of fallbackSeeds) {
				if (added >= needed) break;
				logger.debug("Autoplay", `fallback seed: "${t.info.title}" [${t.info.identifier}]`);
				// biome-ignore lint/performance/noAwaitInLoops: sequential fallback with early exit
				const more = await fetchRecs(t.info.identifier);
				if (more?.length) {
					const picked = pickRandom(more, isDuplicate, played, REC_POOL_SIZE, needed - added);
					queueTracks(player, picked, {}, lastTrack.requester);
					added += picked.length;
				}
			}
		}
	}

	const needsYtMix = added < needed && (!seedId || !seedIsReliable || added === 0);

	if (needsYtMix) {
		logger.debug("Autoplay", `YT mix fallback: added=${added} seedReliable=${seedIsReliable}`);
		const { title: ytTitle, author: ytAuthor } = cleanForYt(lastTrack);

		logger.debug("Autoplay", `YT mix: resolving id for "${ytTitle}" by "${ytAuthor}"`);
		const ytId = await resolveYtVideoId(manager, ytTitle, ytAuthor);

		if (ytId) {
			const mixTracks = await fetchYtMixTracks(manager, ytId);

			if (mixTracks?.length) {
				const remaining = needed - added;
				const picked = pickRandom(mixTracks, isDuplicate, played, YT_POOL_SIZE, remaining);
				logger.debug("Autoplay", `YT mix: picked ${picked.length}/${remaining}`);
				queueTracks(player, picked, { fromYtMix: true }, lastTrack.requester);
				added += picked.length;
			} else {
				logger.debug("Autoplay", "YT mix: no usable tracks");
			}
		} else {
			logger.debug("Autoplay", "YT mix: could not resolve YT video ID");
		}
	}

	return added;
}

function getRecentRequesterTracks(player: Player, lastTrack: QueueTrack): Map<string, QueueTrack> {
	const byRequester = new Map<string, QueueTrack>();
	for (const t of player.queue.getHistory()) byRequester.set(t.requester.id, t);
	for (const t of player.queue.toArray()) byRequester.set(t.requester.id, t);
	byRequester.set(lastTrack.requester.id, lastTrack);
	return byRequester;
}

async function runDemocraticAutoplay(
	player: Player,
	manager: Manager,
	requesterTracks: Map<string, QueueTrack>,
	isDuplicate: ReturnType<typeof buildDuplicateChecker>,
	played: PlayedTrack[],
): Promise<number> {
	const entries = [...requesterTracks.values()];
	logger.debug("Autoplay", `democratic: seeding for ${entries.length} distinct requesters`);

	const seeds = await Promise.all(
		entries.map(async (track) => ({
			track,
			...(await resolveSeedForTrack(manager, track)),
		})),
	);

	let added = 0;

	for (const { track, seedId, confidence } of seeds) {
		const requester = track.requester;
		const seedIsReliable = confidence >= SEED_CONFIDENCE_THRESHOLD;
		let gotOne = false;

		if (seedId) {
			// biome-ignore lint/performance/noAwaitInLoops: sequential per-requester picks, dedup depends on order
			const recTracks = await fetchRecs(seedId);
			if (recTracks?.length) {
				const picked = pickRandom(recTracks, isDuplicate, played, REC_POOL_SIZE, 1);
				if (picked.length) {
					queueTracks(player, picked, {}, requester);
					added += picked.length;
					gotOne = true;
					logger.debug("Autoplay", `democratic: "${requester.displayName}" <- seed [${seedId}]`);
				}
			}
		}

		if (!gotOne && (!seedId || !seedIsReliable)) {
			const { title: ytTitle, author: ytAuthor } = cleanForYt(track);
			const ytId = await resolveYtVideoId(manager, ytTitle, ytAuthor);
			if (ytId) {
				const mixTracks = await fetchYtMixTracks(manager, ytId);
				if (mixTracks?.length) {
					const picked = pickRandom(mixTracks, isDuplicate, played, YT_POOL_SIZE, 1);
					if (picked.length) {
						queueTracks(player, picked, { fromYtMix: true }, requester);
						added += picked.length;
						gotOne = true;
						logger.debug("Autoplay", `democratic: "${requester.displayName}" <- YT mix [${ytId}]`);
					}
				}
			}
		}

		if (!gotOne) {
			logger.debug("Autoplay", `democratic: no track found for "${requester.displayName}"`);
		}
	}

	return added;
}

export async function executeAutoplay(
	player: Player,
	manager: Manager,
	lastTrack: QueueTrack,
): Promise<void> {
	logger.debug(
		"Autoplay",
		`triggered: "${lastTrack.info.title}" by "${lastTrack.info.author}" [${lastTrack.info.identifier}]`,
	);

	if (!player.getAutoplay()) return;

	const played: PlayedTrack[] = [];
	for (const t of player.queue.getHistory()) registerPlayed(played, t);
	for (const t of player.queue.toArray()) registerPlayed(played, t);
	registerPlayed(played, lastTrack);

	logger.debug("Autoplay", `history: ${played.length} tracks registered`);

	const isDuplicate = buildDuplicateChecker(played);

	const requesterTracks = getRecentRequesterTracks(player, lastTrack);
	const distinctRequesters = requesterTracks.size;

	const useDemocratic =
		player.isFairplay() &&
		distinctRequesters >= DEMOCRATIC_MIN_REQUESTERS &&
		distinctRequesters <= DEMOCRATIC_MAX_REQUESTERS;

	logger.debug(
		"Autoplay",
		`mode: fairplay=${player.isFairplay()} distinctRequesters=${distinctRequesters} -> ${
			useDemocratic ? "democratic" : "single-seed"
		}`,
	);

	const added = useDemocratic
		? await runDemocraticAutoplay(player, manager, requesterTracks, isDuplicate, played)
		: await runSingleSeedAutoplay(player, manager, lastTrack, isDuplicate, played, LIMIT);

	logger.debug(
		"Autoplay",
		`done: ${added} queued (${useDemocratic ? "democratic" : `single-seed, limit ${LIMIT}`})`,
	);
}
