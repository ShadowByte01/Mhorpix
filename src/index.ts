import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ClusterManager, HeartbeatManager } from "discord-hybrid-sharding";
import { config } from "./config/config.js";
import { logger } from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = !config.isProduction;
const manager = new ClusterManager(path.join(__dirname, isDev ? "bot.ts" : "bot.js"), {
	totalShards: isDev ? 1 : "auto",
	shardsPerClusters: isDev ? 1 : 2,
	mode: "process",
	token: config.token,
	respawn: true,
	...(isDev && { execArgv: ["--import", "tsx"] }),
});

manager.extend(
	new HeartbeatManager({
		interval: 2_000,
		maxMissedHeartbeats: 5,
	}),
);

manager.on("clusterCreate", (cluster) => {
	logger.info(
		"ClusterManager",
		`Launched Cluster ${cluster.id} [shards: ${cluster.shardList.join(", ")}]`,
	);

	cluster.on("ready", () => logger.success("ClusterManager", `Cluster ${cluster.id} ready`)); // ready: cluster is connected and ready
	cluster.on(
		"reconnecting",
		() => logger.warn("ClusterManager", `Cluster ${cluster.id} reconnecting`), // reconnecting: cluster lost connection and is attempting to reconnect
	);
	cluster.on(
		"death",
		(_, code) => logger.error("ClusterManager", `Cluster ${cluster.id} died (exit ${code})`), // death: cluster process exited; `code` is the exit code
	);
	cluster.on(
		"error",
		(error) => logger.error("ClusterManager", `Cluster ${cluster.id} error`, error), // error: unhandled error in the cluster
	);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

manager
	.spawn({ timeout: -1 })
	.then(() => logger.info("ClusterManager", "All clusters launched"))
	.catch((error: unknown) => logger.error("ClusterManager", "Spawn error", error as Error));
