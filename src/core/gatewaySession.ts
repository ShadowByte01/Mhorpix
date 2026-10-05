import type { SessionInfo } from "discord.js";
import { getRedis } from "../db/redis.js";
import { logger } from "../utils/logger.js";

const SESSION_PREFIX = "gateway:session";
const SESSION_TTL_SECONDS = 300;

function sessionKey(shardId: number): string {
	return `${SESSION_PREFIX}:${shardId}`;
}

export async function retrieveGatewaySessionInfo(shardId: number): Promise<SessionInfo | null> {
	try {
		const raw = await getRedis().get(sessionKey(shardId));
		if (!raw) return null;
		const info = JSON.parse(raw) as SessionInfo;
		logger.info("Gateway:Session", `Loaded stored session for shard ${shardId}, attempting resume`);
		return info;
	} catch (err) {
		logger.warn(
			"Gateway:Session",
			`Failed to load stored session for shard ${shardId}: ${(err as Error).message}`,
		);
		return null;
	}
}

export async function persistGatewaySessionInfo(
	shardId: number,
	sessionInfo: SessionInfo | null,
): Promise<void> {
	try {
		if (sessionInfo === null) {
			await getRedis().del(sessionKey(shardId));
			return;
		}
		await getRedis().set(
			sessionKey(shardId),
			JSON.stringify(sessionInfo),
			"EX",
			SESSION_TTL_SECONDS,
		);
	} catch (err) {
		logger.warn(
			"Gateway:Session",
			`Failed to persist session for shard ${shardId}: ${(err as Error).message}`,
		);
	}
}
