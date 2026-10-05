import { getRedis } from "../../db/redis.js";
import type { PlayerButtonAction } from "./types.js";

const COOLDOWN_SECONDS = 5;

export async function checkButtonCooldown(
	guildId: string,
	userId: string,
	action: PlayerButtonAction,
): Promise<number> {
	const redis = getRedis();
	const key = `playerButtonCooldown:${action}:${guildId}:${userId}`;

	const ttl = await redis.ttl(key);
	if (ttl > 0) return ttl;

	await redis.setex(key, COOLDOWN_SECONDS, "1");
	return 0;
}
