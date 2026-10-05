import { Redis } from "ioredis";
import { config } from "../config/config.js";
import { logger } from "../utils/logger.js";

let _redis: Redis | null = null;

export function getRedis(): Redis {
	if (_redis) return _redis;

	const url = config.redisUrl;
	if (!url) throw new Error("REDIS_URL is not set");

	_redis = new Redis(url, {
		maxRetriesPerRequest: 3,
		enableReadyCheck: true,
		lazyConnect: false,

		retryStrategy: (times) => {
			if (times > 10) {
				logger.error("REDIS", "too many reconnect attempts — giving up");
				return null;
			}
			return Math.min(times * 200, 3_000); // 200ms then 3s backoff
		},
	});

	_redis.on("error", (err: Error) => {
		logger.error("REDIS", "error", err);
	});
	_redis.on("connect", () => {
		logger.info("REDIS", "connected");
	});
	_redis.on("ready", () => {
		logger.info("REDIS", "ready");
	});
	_redis.on("reconnecting", () => {
		logger.warn("REDIS", "reconnecting…");
	});

	return _redis;
}

export async function closeRedis(): Promise<void> {
	if (!_redis) return;
	await _redis.quit();
	_redis = null;
	logger.info("REDIS", "connection closed");
}
