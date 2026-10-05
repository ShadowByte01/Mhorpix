import { getRedis } from "../../db/redis.js";
import { logger } from "../../utils/logger.js";
import type { Player, PlayerDataStore } from "./Player.js";
import type { LoopMode, PlayerTimestamps, QueueTrack } from "./types.js";

const SNAPSHOT_PREFIX = "music:snapshot";
const SNAPSHOT_TTL_SECONDS = 600;

export interface PlayerSnapshotData {
	readonly guildId: string;
	readonly textChannelId: string | null;
	readonly voiceChannelId: string;
	readonly currentTrack: QueueTrack | null;
	readonly queue: readonly QueueTrack[];
	readonly history: readonly QueueTrack[];
	readonly loop: LoopMode;
	readonly fairplay: boolean;
	readonly autoplay: boolean;
	readonly data: Readonly<Record<string, unknown>>;
	readonly timestamps: PlayerTimestamps;
	readonly savedAt: number;
}

function isSafeToPersist(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	const valueType = typeof value;
	if (valueType === "string" || valueType === "number" || valueType === "boolean") return true;
	if (value instanceof Map || value instanceof Set || value instanceof Date) return false;
	if (valueType === "function" || valueType === "symbol") return false;
	if (Array.isArray(value)) return value.every(isSafeToPersist);
	if (valueType === "object") {
		return Object.values(value as Record<string, unknown>).every(isSafeToPersist);
	}
	return false;
}

function serializeDataStore(store: PlayerDataStore): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of store.getAll()) {
		if (isSafeToPersist(value)) {
			out[key] = value;
		} else {
			logger.warn(
				"Music:Persistence",
				`Skipping non-plain-JSON data key "${key}" during snapshot (Map/Set/class instance/function values can't round-trip through Redis)`,
			);
		}
	}
	return out;
}

function snapshotKey(guildId: string): string {
	return `${SNAPSHOT_PREFIX}:${guildId}`;
}

export async function savePlayerSnapshot(player: Player): Promise<void> {
	if (player.destroyed) return;

	const data: PlayerSnapshotData = {
		guildId: player.guildId,
		textChannelId: player.currentTextChannelId,
		voiceChannelId: player.voiceChannelId,
		currentTrack: player.currentTrack,
		queue: player.queue.toArray(),
		history: player.queue.getHistory(),
		loop: player.getLoop(),
		fairplay: player.isFairplay(),
		autoplay: player.getAutoplay(),
		data: serializeDataStore(player.data),
		timestamps: { ...player.timestamps },
		savedAt: Date.now(),
	};

	try {
		await getRedis().set(
			snapshotKey(player.guildId),
			JSON.stringify(data),
			"EX",
			SNAPSHOT_TTL_SECONDS,
		);
	} catch (err) {
		logger.warn(
			"Music:Persistence",
			`Failed to save snapshot for ${player.guildId}: ${(err as Error).message}`,
		);
	}
}

export async function loadPlayerSnapshot(guildId: string): Promise<PlayerSnapshotData | null> {
	try {
		const raw = await getRedis().get(snapshotKey(guildId));
		return raw ? (JSON.parse(raw) as PlayerSnapshotData) : null;
	} catch (err) {
		logger.warn(
			"Music:Persistence",
			`Failed to load snapshot for ${guildId}: ${(err as Error).message}`,
		);
		return null;
	}
}

export async function clearPlayerSnapshot(guildId: string): Promise<void> {
	try {
		await getRedis().del(snapshotKey(guildId));
	} catch {
		// best-effort — a leftover snapshot just expires on its own via TTL
	}
}

export async function loadAllSnapshotGuildIds(): Promise<string[]> {
	const redis = getRedis();
	const ids: string[] = [];
	let cursor = "0";
	try {
		do {
			// biome-ignore lint/performance/noAwaitInLoops: required
			const [next, keys] = await redis.scan(cursor, "MATCH", `${SNAPSHOT_PREFIX}:*`, "COUNT", 200);
			cursor = next;
			for (const k of keys) ids.push(k.slice(SNAPSHOT_PREFIX.length + 1));
		} while (cursor !== "0");
	} catch (err) {
		logger.warn("Music:Persistence", `Failed to scan snapshot keys: ${(err as Error).message}`);
	}
	return ids;
}
