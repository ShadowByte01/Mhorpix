import { Node } from "shoukaku";
import { getRedis } from "../../db/redis.js";
import { logger } from "../../utils/logger.js";

const SESSION_PREFIX = "music:lavalinkSession";
const SESSION_TTL_SECONDS = 600;

function sessionKey(clusterId: number, nodeName: string): string {
	return `${SESSION_PREFIX}:${clusterId}:${nodeName}`;
}

const _warmSessions = new Map<string, string>();
let _patched = false;

export async function warmSessionCache(
	clusterId: number,
	nodeNames: readonly string[],
): Promise<void> {
	const redis = getRedis();
	await Promise.all(
		nodeNames.map(async (name) => {
			try {
				const stored = await redis.get(sessionKey(clusterId, name));
				if (stored) {
					_warmSessions.set(name, stored);
					logger.info(
						"Music:Session",
						`Warmed stored session "${stored}" for node "${name}" (cluster ${clusterId})`,
					);
				}
			} catch (err) {
				logger.warn(
					"Music:Session",
					`Failed to load stored session for node "${name}": ${(err as Error).message}`,
				);
			}
		}),
	);
}

export function installSessionResumePatch(): void {
	if (_patched) return;
	_patched = true;

	const originalConnect = Node.prototype.connect;
	Node.prototype.connect = function patchedConnect(this: Node, ...args: unknown[]) {
		if (!this.sessionId) {
			const stored = _warmSessions.get(this.name);
			if (stored) {
				this.sessionId = stored;
				logger.info(
					"Music:Session",
					`Attempting resume for node "${this.name}" using session "${stored}"`,
				);
			}
		}
		return (originalConnect as (...a: unknown[]) => Promise<void>).apply(this, args);
	};
}

export async function persistSessionId(
	clusterId: number,
	nodeName: string,
	sessionId: string,
): Promise<void> {
	try {
		await getRedis().set(sessionKey(clusterId, nodeName), sessionId, "EX", SESSION_TTL_SECONDS);
	} catch (err) {
		logger.warn(
			"Music:Session",
			`Failed to persist session for node "${nodeName}": ${(err as Error).message}`,
		);
	}
}
