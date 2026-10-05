import { config } from "../../config/config.js";
import type { FavouriteTrack } from "../../structures/music/index.js";
import { logger } from "../../utils/logger.js";
import { query } from "../pg.js";
import { getRedis } from "../redis.js";
import { BaseStore } from "../store.js";
import { userPremiumStore } from "./userPremium.js";

async function hasPremiumAccess(userId: string): Promise<boolean> {
	const premium = await userPremiumStore.get(userId);
	return Boolean(premium);
}

export async function getFavouritesLimit(userId: string): Promise<number> {
	if (!userId) return config.limits.free.favs;
	const premium = await hasPremiumAccess(userId);
	return premium ? config.limits.premium.favs : config.limits.free.favs;
}

export async function getHistoryLimit(userId: string): Promise<number> {
	if (!userId) return config.limits.free.history;
	const premium = await hasPremiumAccess(userId);
	return premium ? config.limits.premium.history : config.limits.free.history;
}

export interface HistoryEntry {
	readonly encoded: string;
	readonly playedAt: number;
}

export interface MusicRow {
	id: string;
	history: HistoryEntry[];
	history_enabled: boolean;
	favorites: FavouriteTrack[];
	spotify_profile_url: string | null;
	spotify_public_profile: boolean;
}

export interface Music {
	id: string;
	history: HistoryEntry[];
	historyEnabled: boolean;
	favourites: FavouriteTrack[];
	spotifyProfileUrl: string | null;
	spotifyPublicProfile: boolean;
}

function fromRow(row: MusicRow): Music {
	return {
		id: row.id,
		history: row.history ?? [],
		historyEnabled: row.history_enabled,
		favourites: row.favorites ?? [],
		spotifyProfileUrl: row.spotify_profile_url,
		spotifyPublicProfile: row.spotify_public_profile,
	};
}

function defaults(id: string): Music {
	return {
		id,
		history: [],
		historyEnabled: true,
		favourites: [],
		spotifyProfileUrl: null,
		spotifyPublicProfile: false,
	};
}

function buildUpsert(entity: Music): [string, unknown[]] {
	const sql = `
		INSERT INTO music (id, history, history_enabled, favorites, spotify_profile_url, spotify_public_profile)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (id) DO UPDATE SET
			history = EXCLUDED.history,
			history_enabled = EXCLUDED.history_enabled,
			favorites = EXCLUDED.favorites,
			spotify_profile_url = EXCLUDED.spotify_profile_url,
			spotify_public_profile = EXCLUDED.spotify_public_profile
		RETURNING *
	`;

	const values = [
		entity.id,
		JSON.stringify(entity.history),
		entity.historyEnabled,
		JSON.stringify(entity.favourites),
		entity.spotifyProfileUrl,
		entity.spotifyPublicProfile,
	];

	return [sql, values];
}

export const musicStore = new BaseStore<MusicRow, Music, "id">({
	table: "music",
	keyPrefix: "music",
	primaryKey: "id",
	fromRow,
	buildUpsert,
});

export async function ensureMusic(id: string): Promise<Music> {
	return musicStore.getOrCreate(id, () => defaults(id));
}

export type FavouriteAddResult =
	| { readonly ok: true; readonly favourites: readonly FavouriteTrack[] }
	| { readonly ok: false; readonly reason: "ALREADY_FAVOURITED" | "LIMIT_REACHED" };

export async function addFavourite(userId: string, encoded: string): Promise<FavouriteAddResult> {
	const music = await ensureMusic(userId);

	if (music.favourites.some((f) => f.encoded === encoded)) {
		return { ok: false, reason: "ALREADY_FAVOURITED" };
	}
	const limit = await getFavouritesLimit(userId);
	if (music.favourites.length >= limit) {
		return { ok: false, reason: "LIMIT_REACHED" };
	}

	const favourites: FavouriteTrack[] = [{ encoded, addedAt: Date.now() }, ...music.favourites];
	const saved = await musicStore.set({ ...music, favourites });
	return { ok: true, favourites: saved.favourites };
}

export async function removeFavourite(userId: string, encoded: string): Promise<boolean> {
	const music = await ensureMusic(userId);
	const favourites = music.favourites.filter((f) => f.encoded !== encoded);
	if (favourites.length === music.favourites.length) return false;

	await musicStore.set({ ...music, favourites });
	return true;
}

export async function isFavourited(userId: string, encoded: string): Promise<boolean> {
	const music = await ensureMusic(userId);
	return music.favourites.some((f) => f.encoded === encoded);
}

export async function getFavourites(
	userId: string,
	options: { readonly offset?: number; readonly limit?: number } = {},
): Promise<readonly FavouriteTrack[]> {
	const music = await ensureMusic(userId);
	let favourites = music.favourites;
	if (options.offset) favourites = favourites.slice(options.offset);
	if (options.limit) favourites = favourites.slice(0, options.limit);
	return favourites;
}

export async function getFavouriteCount(userId: string): Promise<number> {
	const music = await ensureMusic(userId);
	return music.favourites.length;
}

export async function clearFavourites(userId: string): Promise<boolean> {
	const music = await ensureMusic(userId);
	if (music.favourites.length === 0) return false;
	await musicStore.set({ ...music, favourites: [] });
	return true;
}

export async function getSpotifyProfile(userId: string): Promise<string | null> {
	const music = await ensureMusic(userId);
	return music.spotifyProfileUrl;
}

export async function setSpotifyProfile(userId: string, spotifyId: string): Promise<void> {
	const music = await ensureMusic(userId);
	await musicStore.set({ ...music, spotifyProfileUrl: spotifyId });
}

export async function clearSpotifyProfile(userId: string): Promise<boolean> {
	const music = await ensureMusic(userId);
	if (!music.spotifyProfileUrl) return false;
	await musicStore.set({ ...music, spotifyProfileUrl: null });
	return true;
}

export async function addToHistory(userId: string, encoded: string): Promise<boolean> {
	const music = await ensureMusic(userId);
	if (!music.historyEnabled) return false;

	const history = music.history.filter((h) => h.encoded !== encoded);
	history.unshift({ encoded, playedAt: Date.now() });

	const limit = await getHistoryLimit(userId);
	const trimmed = history.length > limit ? history.slice(0, limit) : history;
	await musicStore.set({ ...music, history: trimmed });
	return true;
}

export async function addManyToHistory(userIds: readonly string[], encoded: string): Promise<void> {
	const uniqueIds = [...new Set(userIds)];
	if (uniqueIds.length === 0) return;

	const cached = await musicStore.getMany(uniqueIds);
	const missingIds = uniqueIds.filter((_, i) => cached[i] === null);
	const fetchedMissing = missingIds.length
		? await Promise.all(missingIds.map((id) => ensureMusic(id)))
		: [];

	const byId = new Map<string, Music>();
	uniqueIds.forEach((id, i) => {
		const entity = cached[i];
		if (entity) byId.set(id, entity);
	});
	for (const entity of fetchedMissing) byId.set(entity.id, entity);

	const eligibleIds = uniqueIds.filter((id) => byId.get(id)?.historyEnabled);
	const limits = new Map<string, number>(
		await Promise.all(eligibleIds.map(async (id) => [id, await getHistoryLimit(id)] as const)),
	);

	const toWrite: Music[] = [];
	for (const id of uniqueIds) {
		const music = byId.get(id);
		if (!music) continue;
		if (!music.historyEnabled) continue;

		const history = music.history.filter((h) => h.encoded !== encoded);
		history.unshift({ encoded, playedAt: Date.now() });
		const limit = limits.get(id) ?? config.limits.free.history;
		const trimmed = history.length > limit ? history.slice(0, limit) : history;

		toWrite.push({ ...music, history: trimmed });
	}

	if (toWrite.length === 0) return;

	const columns = [
		"id",
		"history",
		"history_enabled",
		"favorites",
		"spotify_profile_url",
		"spotify_public_profile",
	] as const;

	const values: unknown[] = [];
	const rowPlaceholders = toWrite.map((entity, rowIndex) => {
		const base = rowIndex * columns.length;
		values.push(
			entity.id,
			JSON.stringify(entity.history),
			entity.historyEnabled,
			JSON.stringify(entity.favourites),
			entity.spotifyProfileUrl,
			entity.spotifyPublicProfile,
		);
		return `(${columns.map((_, colIndex) => `$${base + colIndex + 1}`).join(", ")})`;
	});

	const sql = `
		INSERT INTO music (${columns.join(", ")})
		VALUES ${rowPlaceholders.join(", ")}
		ON CONFLICT (id) DO UPDATE SET
			history = EXCLUDED.history,
			history_enabled = EXCLUDED.history_enabled,
			favorites = EXCLUDED.favorites,
			spotify_profile_url = EXCLUDED.spotify_profile_url,
			spotify_public_profile = EXCLUDED.spotify_public_profile
		RETURNING *
	`;

	const rows = await query<MusicRow>(sql, values);
	const savedEntities = rows.map(fromRow);

	try {
		const pipe = getRedis().pipeline();
		for (const entity of savedEntities) {
			pipe.hset(musicStore.hashKey, entity.id, JSON.stringify(entity));
		}
		await pipe.exec();
	} catch (err) {
		logger.warn(
			"DBMS",
			`[music] Redis sync failed after bulk history write: ${(err as Error).message}`,
		);
	}
}

export async function removeFromHistory(userId: string, encoded: string): Promise<boolean> {
	const music = await ensureMusic(userId);
	const history = music.history.filter((h) => h.encoded !== encoded);
	if (history.length === music.history.length) return false;

	await musicStore.set({ ...music, history });
	return true;
}

export async function getHistory(
	userId: string,
	options: { readonly offset?: number; readonly limit?: number } = {},
): Promise<readonly HistoryEntry[]> {
	const music = await ensureMusic(userId);
	let history = music.history;
	if (options.offset) history = history.slice(options.offset);
	if (options.limit) history = history.slice(0, options.limit);
	return history;
}

export async function getHistoryCount(userId: string): Promise<number> {
	const music = await ensureMusic(userId);
	return music.history.length;
}

export async function clearHistory(userId: string): Promise<boolean> {
	const music = await ensureMusic(userId);
	if (music.history.length === 0) return false;
	await musicStore.set({ ...music, history: [] });
	return true;
}

export async function isHistoryEnabled(userId: string): Promise<boolean> {
	const music = await ensureMusic(userId);
	return music.historyEnabled;
}

export async function setHistoryEnabled(userId: string, enabled: boolean): Promise<void> {
	const music = await ensureMusic(userId);
	await musicStore.set({ ...music, historyEnabled: enabled });
}
