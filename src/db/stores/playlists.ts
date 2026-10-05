import { randomFillSync } from "node:crypto";
import { config } from "../../config/config.js";
import { logger } from "../../utils/logger.js";
import { query, queryOne, withTransaction } from "../pg.js";
import { getRedis } from "../redis.js";
import { BaseStore } from "../store.js";
import { userPremiumStore } from "./userPremium.js";

const ID_LENGTH = 6;
const NAME_MAX_LENGTH = 100;
const MAX_ID_ATTEMPTS = 5;

const PG_UNIQUE_VIOLATION = "23505";
export interface PlaylistRow {
	id: string;
	user_id: string;
	name: string;
	track_count: number;
	created_at: Date;
	updated_at: Date;
}

export interface Playlist {
	id: string;
	userId: string;
	name: string;
	trackCount: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface PlaylistTrackRow {
	playlist_id: string;
	encoded: string;
	position: number;
	added_by: string;
	added_at: Date;
}

export interface PlaylistTrack {
	encoded: string;
	position: number;
	addedBy: string;
	addedAt: Date;
}

export type PlaylistCreateError =
	| "INVALID_NAME"
	| "NAME_TOO_LONG"
	| "LIMIT_REACHED"
	| "DUPLICATE_NAME";

export type PlaylistTrackError =
	| "NOT_FOUND"
	| "NO_PERMISSION"
	| "TRACK_LIMIT"
	| "DUPLICATE"
	| "NO_NEW_TRACKS"
	| "INVALID_INPUT";

export type PlaylistResult<T, E extends string> =
	| { readonly success: true; readonly data: T }
	| {
			readonly success: false;
			readonly error: E;
			readonly limit?: number;
			readonly skipped?: number;
	  };
function fromRow(row: PlaylistRow): Playlist {
	return {
		id: row.id,
		userId: row.user_id,
		name: row.name,
		trackCount: row.track_count,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function buildUpsert(entity: Playlist): [string, unknown[]] {
	const sql = `
		INSERT INTO playlists (id, user_id, name, track_count, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			track_count = EXCLUDED.track_count,
			updated_at = NOW()
		RETURNING *
	`;
	const values = [entity.id, entity.userId, entity.name, entity.trackCount, entity.createdAt];
	return [sql, values];
}

export const playlistStore = new BaseStore<PlaylistRow, Playlist, "id">({
	table: "playlists",
	keyPrefix: "playlist",
	primaryKey: "id",
	fromRow,
	buildUpsert,
});

class RandomIdPool {
	private pool: Buffer;
	private offset: number;
	private static readonly BYTES_PER_ID = 5;

	constructor(poolSize = 10_000_000) {
		this.pool = Buffer.allocUnsafe(poolSize);
		this.offset = poolSize;
	}

	private refill(): void {
		randomFillSync(this.pool);
		this.offset = 0;
	}

	next(): string {
		if (this.offset + RandomIdPool.BYTES_PER_ID > this.pool.length) this.refill();
		const n = this.pool.readUIntBE(this.offset, RandomIdPool.BYTES_PER_ID);
		this.offset += RandomIdPool.BYTES_PER_ID;
		return n.toString(36).padStart(ID_LENGTH, "0").slice(-ID_LENGTH);
	}
}

const idPool = new RandomIdPool();
async function hasPremiumAccess(userId: string): Promise<boolean> {
	const premium = await userPremiumStore.get(userId);
	return Boolean(premium);
}

export async function getPlaylistLimit(userId: string): Promise<number> {
	if (!userId) return config.limits.free.playlists;
	const premium = await hasPremiumAccess(userId);
	return premium ? config.limits.premium.playlists : config.limits.free.playlists;
}

export async function getTrackLimit(userId: string): Promise<number> {
	if (!userId) return config.limits.free.playlistSongs;
	const premium = await hasPremiumAccess(userId);
	return premium ? config.limits.premium.playlistSongs : config.limits.free.playlistSongs;
}

export async function getPlaylist(id: string): Promise<Playlist | null> {
	if (!id) return null;
	return playlistStore.get(id);
}

export async function getUserPlaylists(userId: string): Promise<Playlist[]> {
	if (!userId) return [];
	// Deliberately bypasses playlistStore's Redis cache: playlistStore.getAll()
	// is a full-table HGETALL, which is O(every playlist that exists across
	// every server) — bottleneck once the table
	// is large. pl_user_idx (playlists.sql) makes this an indexed lookup
	// instead, same tradeoff getUserPlaylistCount already makes below.
	const rows = await query<PlaylistRow>(
		"SELECT * FROM playlists WHERE user_id = $1 ORDER BY created_at ASC",
		[userId],
	);
	return rows.map(fromRow);
}

export async function getUserPlaylistCount(userId: string): Promise<number> {
	if (!userId) return 0;
	const row = await queryOne<{ count: string }>(
		"SELECT COUNT(*)::text AS count FROM playlists WHERE user_id = $1",
		[userId],
	);
	return row ? Number(row.count) : 0;
}

export async function createPlaylist(
	userId: string,
	name: string,
): Promise<PlaylistResult<Playlist, PlaylistCreateError>> {
	if (!userId) return { success: false, error: "INVALID_NAME" };

	const trimmed = name?.trim() ?? "";
	if (!trimmed) return { success: false, error: "INVALID_NAME" };
	if (trimmed.length > NAME_MAX_LENGTH) return { success: false, error: "NAME_TOO_LONG" };

	const [count, existing, limit] = await Promise.all([
		getUserPlaylistCount(userId),
		getUserPlaylists(userId),
		getPlaylistLimit(userId),
	]);

	if (count >= limit) return { success: false, error: "LIMIT_REACHED", limit };
	if (existing.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
		return { success: false, error: "DUPLICATE_NAME" };
	}

	for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
		const id = idPool.next();
		try {
			const now = new Date();
			// biome-ignore lint/performance/noAwaitInLoops: intentionally sequential — each attempt needs to know whether this id collided in PG before generating the next one
			const playlist = await playlistStore.set({
				id,
				userId,
				name: trimmed,
				trackCount: 0,
				createdAt: now,
				updatedAt: now,
			});
			await seedTrackCache(id);
			logger.info("PLAYLIST", `created ${id} for ${userId}`);
			return { success: true, data: playlist };
		} catch (err) {
			if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) continue;
			logger.error("PLAYLIST", `create failed for ${userId}:`, err as Error);
			throw err;
		}
	}

	throw new Error(`[playlist] failed to generate a unique id after ${MAX_ID_ATTEMPTS} attempts`);
}

export async function deletePlaylist(id: string, userId: string): Promise<boolean> {
	if (!id || !userId) return false;

	const playlist = await getPlaylist(id);
	if (!playlist || playlist.userId !== userId) return false;

	await playlistStore.delete(id);
	await deleteTrackCache(id);
	logger.info("PLAYLIST", `deleted ${id}`);
	return true;
}

export async function renamePlaylist(id: string, userId: string, name: string): Promise<boolean> {
	if (!id || !userId) return false;

	const playlist = await getPlaylist(id);
	if (!playlist || playlist.userId !== userId) return false;

	const trimmed = name?.trim() ?? "";
	if (!trimmed || trimmed.length > NAME_MAX_LENGTH) return false;
	if (trimmed === playlist.name) return true;

	await playlistStore.set({ ...playlist, name: trimmed });
	logger.info("PLAYLIST", `renamed ${id}`);
	return true;
}

export async function canEditPlaylist(id: string, userId: string): Promise<boolean> {
	if (!id || !userId) return false;
	const playlist = await getPlaylist(id);
	return playlist?.userId === userId;
}
const TRACKS_HASH_KEY = "playlistTracks:hash";

function rowToTrack(row: PlaylistTrackRow): PlaylistTrack {
	return {
		encoded: row.encoded,
		position: row.position,
		addedBy: row.added_by,
		addedAt: row.added_at,
	};
}

async function fetchTracksFromPg(playlistId: string): Promise<PlaylistTrack[]> {
	const rows = await query<PlaylistTrackRow>(
		"SELECT * FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position ASC",
		[playlistId],
	);
	return rows.map(rowToTrack);
}

async function refreshTrackCache(playlistId: string): Promise<void> {
	const tracks = await fetchTracksFromPg(playlistId);
	try {
		await getRedis().hset(TRACKS_HASH_KEY, playlistId, JSON.stringify(tracks));
	} catch (err) {
		logger.warn("PLAYLIST", `track cache sync failed for ${playlistId}: ${(err as Error).message}`);
	}
}
async function seedTrackCache(playlistId: string): Promise<void> {
	try {
		await getRedis().hset(TRACKS_HASH_KEY, playlistId, "[]");
	} catch (err) {
		logger.warn("PLAYLIST", `track cache seed failed for ${playlistId}: ${(err as Error).message}`);
	}
}

async function deleteTrackCache(playlistId: string): Promise<void> {
	try {
		await getRedis().hdel(TRACKS_HASH_KEY, playlistId);
	} catch (err) {
		logger.warn(
			"PLAYLIST",
			`track cache eviction failed for ${playlistId}: ${(err as Error).message}`,
		);
	}
}

export async function hydratePlaylistTracks(): Promise<void> {
	const [playlistIds, trackRows] = await Promise.all([
		query<{ id: string }>("SELECT id FROM playlists"),
		query<PlaylistTrackRow>("SELECT * FROM playlist_tracks ORDER BY playlist_id, position ASC"),
	]);

	const byPlaylist = new Map<string, PlaylistTrack[]>();
	for (const { id } of playlistIds) byPlaylist.set(id, []);
	for (const row of trackRows) {
		const list = byPlaylist.get(row.playlist_id);
		if (list) list.push(rowToTrack(row));
		else byPlaylist.set(row.playlist_id, [rowToTrack(row)]); // orphaned row, cache it anyway
	}

	logger.info("DBMS", `[playlist_tracks] hydrating ${byPlaylist.size} playlist(s)`);

	const redis = getRedis();
	const tmpKey = `${TRACKS_HASH_KEY}:tmp:${Date.now()}`;
	const pipe = redis.pipeline();
	for (const [playlistId, tracks] of byPlaylist) {
		pipe.hset(tmpKey, playlistId, JSON.stringify(tracks));
	}

	if (byPlaylist.size > 0) {
		pipe.rename(tmpKey, TRACKS_HASH_KEY);
	} else {
		pipe.del(TRACKS_HASH_KEY);
	}

	try {
		const results = await pipe.exec();
		if (results) {
			for (const [err] of results) {
				if (err) throw err;
			}
		}
	} catch (err) {
		redis.del(tmpKey).catch(() => undefined);
		throw err;
	}

	logger.info("DBMS", "[playlist_tracks] hydration complete");
}

export async function getTracks(id: string): Promise<PlaylistTrack[]> {
	if (!id) return [];

	try {
		const cached = await getRedis().hget(TRACKS_HASH_KEY, id);
		if (cached !== null) return JSON.parse(cached) as PlaylistTrack[];
	} catch (err) {
		logger.warn("PLAYLIST", `track cache read failed for ${id}: ${(err as Error).message}`);
	}

	const tracks = await fetchTracksFromPg(id);
	await refreshTrackCache(id);
	return tracks;
}

export async function addTrack(
	id: string,
	userId: string,
	encoded: string,
): Promise<PlaylistResult<null, PlaylistTrackError>> {
	if (!id || !userId || !encoded) return { success: false, error: "INVALID_INPUT" };

	const playlist = await getPlaylist(id);
	if (!playlist) return { success: false, error: "NOT_FOUND" };
	if (playlist.userId !== userId) return { success: false, error: "NO_PERMISSION" };

	const limit = await getTrackLimit(playlist.userId);
	if (playlist.trackCount >= limit) return { success: false, error: "TRACK_LIMIT", limit };

	const inserted = await withTransaction(async (client) => {
		const result = await client.query(
			`INSERT INTO playlist_tracks (playlist_id, encoded, position, added_by)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (playlist_id, encoded) DO NOTHING`,
			[id, encoded, playlist.trackCount, userId],
		);
		if (result.rowCount === 0) return false;

		await client.query(
			"UPDATE playlists SET track_count = track_count + 1, updated_at = NOW() WHERE id = $1",
			[id],
		);
		return true;
	});

	if (!inserted) return { success: false, error: "DUPLICATE" };

	await Promise.all([playlistStore.refresh(id), refreshTrackCache(id)]);
	logger.info("PLAYLIST", `added track to ${id}`);
	return { success: true, data: null };
}

export async function addTracks(
	id: string,
	userId: string,
	encodedList: string[],
): Promise<PlaylistResult<{ added: number; skipped: number }, PlaylistTrackError>> {
	if (!id || !userId || !Array.isArray(encodedList) || encodedList.length === 0) {
		return { success: false, error: "INVALID_INPUT" };
	}

	const playlist = await getPlaylist(id);
	if (!playlist) return { success: false, error: "NOT_FOUND" };
	if (playlist.userId !== userId) return { success: false, error: "NO_PERMISSION" };

	const valid = encodedList.filter((e): e is string => typeof e === "string" && e.length > 0);
	if (valid.length === 0) return { success: false, error: "INVALID_INPUT" };

	const limit = await getTrackLimit(playlist.userId);
	const available = limit - playlist.trackCount;
	if (available <= 0) return { success: false, error: "TRACK_LIMIT", limit };

	const batch = valid.slice(0, available);

	const addedCount = await withTransaction(async (client) => {
		const values: unknown[] = [];
		const placeholders = batch.map((encoded, i) => {
			const base = i * 4;
			values.push(id, encoded, playlist.trackCount + i, userId);
			return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
		});

		const result = await client.query(
			`INSERT INTO playlist_tracks (playlist_id, encoded, position, added_by)
			 VALUES ${placeholders.join(", ")}
			 ON CONFLICT (playlist_id, encoded) DO NOTHING`,
			values,
		);
		const inserted = result.rowCount ?? 0;

		if (inserted > 0) {
			await client.query(
				"UPDATE playlists SET track_count = track_count + $2, updated_at = NOW() WHERE id = $1",
				[id, inserted],
			);
		}
		return inserted;
	});

	const skipped = valid.length - addedCount;

	if (addedCount === 0) return { success: false, error: "NO_NEW_TRACKS", skipped };

	await Promise.all([playlistStore.refresh(id), refreshTrackCache(id)]);
	logger.info("PLAYLIST", `added ${addedCount} tracks to ${id}`);
	return { success: true, data: { added: addedCount, skipped } };
}

export async function removeTrack(id: string, userId: string, encoded: string): Promise<boolean> {
	if (!id || !userId || !encoded) return false;

	const playlist = await getPlaylist(id);
	if (!playlist || playlist.userId !== userId) return false;

	const removed = await withTransaction(async (client) => {
		const result = await client.query(
			"DELETE FROM playlist_tracks WHERE playlist_id = $1 AND encoded = $2",
			[id, encoded],
		);
		if (result.rowCount === 0) return false;

		await client.query(
			"UPDATE playlists SET track_count = GREATEST(track_count - 1, 0), updated_at = NOW() WHERE id = $1",
			[id],
		);
		return true;
	});

	if (!removed) return false;

	await Promise.all([playlistStore.refresh(id), refreshTrackCache(id)]);
	logger.info("PLAYLIST", `removed track from ${id}`);
	return true;
}

export async function removeTracks(
	id: string,
	userId: string,
	encodedList: string[],
): Promise<number> {
	if (!id || !userId || !Array.isArray(encodedList) || encodedList.length === 0) return 0;

	const playlist = await getPlaylist(id);
	if (!playlist || playlist.userId !== userId) return 0;

	const valid = encodedList.filter((e): e is string => typeof e === "string" && e.length > 0);
	if (valid.length === 0) return 0;

	const removedCount = await withTransaction(async (client) => {
		const result = await client.query(
			"DELETE FROM playlist_tracks WHERE playlist_id = $1 AND encoded = ANY($2::text[])",
			[id, valid],
		);
		const count = result.rowCount ?? 0;
		if (count > 0) {
			await client.query(
				"UPDATE playlists SET track_count = GREATEST(track_count - $2, 0), updated_at = NOW() WHERE id = $1",
				[id, count],
			);
		}
		return count;
	});

	if (removedCount > 0) {
		await Promise.all([playlistStore.refresh(id), refreshTrackCache(id)]);
		logger.info("PLAYLIST", `removed ${removedCount} tracks from ${id}`);
	}

	return removedCount;
}

export async function clearTracks(id: string, userId: string): Promise<boolean> {
	if (!id || !userId) return false;

	const playlist = await getPlaylist(id);
	if (!playlist || playlist.userId !== userId) return false;
	if (playlist.trackCount === 0) return false;

	await withTransaction(async (client) => {
		await client.query("DELETE FROM playlist_tracks WHERE playlist_id = $1", [id]);
		await client.query("UPDATE playlists SET track_count = 0, updated_at = NOW() WHERE id = $1", [
			id,
		]);
	});

	await Promise.all([playlistStore.refresh(id), refreshTrackCache(id)]);
	logger.info("PLAYLIST", `cleared tracks from ${id}`);
	return true;
}

export async function reorderTracks(
	id: string,
	userId: string,
	encodedOrder: string[],
): Promise<boolean> {
	if (!id || !userId || !Array.isArray(encodedOrder) || encodedOrder.length === 0) return false;

	const playlist = await getPlaylist(id);
	if (!playlist || playlist.userId !== userId) return false;

	await withTransaction(async (client) => {
		await client.query("DELETE FROM playlist_tracks WHERE playlist_id = $1", [id]);

		const values: unknown[] = [];
		const placeholders = encodedOrder.map((encoded, i) => {
			const base = i * 4;
			values.push(id, encoded, i, userId);
			return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
		});

		await client.query(
			`INSERT INTO playlist_tracks (playlist_id, encoded, position, added_by)
			 VALUES ${placeholders.join(", ")}
			 ON CONFLICT (playlist_id, encoded) DO UPDATE SET position = EXCLUDED.position`,
			values,
		);
	});

	await refreshTrackCache(id);
	logger.info("PLAYLIST", `reordered ${id}`);
	return true;
}
