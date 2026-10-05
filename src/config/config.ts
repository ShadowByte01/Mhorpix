import type { ShoukakuOptions } from "shoukaku";
import { env } from "./env.js";

export const config = {
	token: env.DISCORD_TOKEN,
	clientId: env.DISCORD_CLIENT_ID,
	environment: env.NODE_ENV,
	isProduction: env.NODE_ENV === "production",
	supportLink: env.SUPPORT_LINK,
	redisUrl: env.REDIS_URL,
	postgresUrl: env.POSTGRES_URL,
	ownerIds: [] as string[],
	voteEnabled: env.VOTE_ENABLED,
	colors: {
		default: 0xffffe8,
		success: 0x2ecc71,
		error: 0xed4245,
		warn: 0xfee75c,
	},
	logging: {
		level: env.NODE_ENV === "production" ? ("info" as const) : ("debug" as const),
		dir: "logs",
		maxFiles: 10,
		timezone: "Asia/Kolkata",
	},
	limits: {
		free: {
			playlists: 5,
			playlistSongs: 25,
			favs: 15,
			history: 5,
		},
		premium: {
			playlists: 15,
			playlistSongs: 30,
			favs: 30,
			history: 15,
		},
	},
	lavalink: {
		nodes: [
			{
				name: env.LAVALINK_NODE_NAME,
				url: `${env.LAVALINK_HOST}:${env.LAVALINK_PORT}`,
				auth: env.LAVALINK_AUTH,
				secure: env.LAVALINK_SECURE,
			},
		],
		options: {
			resume: true,
			resumeTimeout: 600,
			resumeByLibrary: true,
			reconnectTries: 5,
			reconnectInterval: 5,
			restTimeout: 150,
			moveOnDisconnect: true,
			voiceConnectionTimeout: 15,
		} satisfies ShoukakuOptions,
	},
	webhookPort: env.WEBHOOK_PORT,
	topgg: {
		webhookSecret: env.TOPGG_WEBHOOK_SECRET,
	},
	premium: {
		webhookSecret: env.PREMIUM_WEBHOOK_SECRET,
	},
	dbBackup: {
		webhookUrl: env.backupWebhook,
	},
} as const;

/** The inferred static type of the {@link config} object. */
export type Config = typeof config;
