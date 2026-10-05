import { getRedis } from "../db/redis.js";
import type { MiddlewareFn } from "../types/middleware.js";
import { ok, withLabel } from "../types/middleware.js";

function commandKey(name: string | string[]): string {
	return Array.isArray(name) ? name.join("/") : name;
}

export function cooldown(seconds: number): MiddlewareFn {
	return withLabel(`Cooldown: ${seconds}s`, async (_ctx, _command) => {
		return ok();
	});
}

/**
 * Clears the cooldown for a command so the user can immediately retry after a
 * failure (e.g. a track that failed to play). Used by /play when the search or
 * playback fails — this stops the "always on cooldown" loop where every failed
 * attempt locks the user out for the full cooldown window.
 */
export async function clearCommandCooldown(
	name: string | string[],
	userId: string,
	guildId: string,
): Promise<void> {
	const redis = getRedis();
	const key = `cooldown:${commandKey(name)}:${userId}:${guildId}`;
	const informedKey = `${key}:informed`;
	await redis.del(key, informedKey);
}
