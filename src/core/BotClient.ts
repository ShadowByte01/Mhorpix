import type { SessionInfo, WebSocketOptions } from "discord.js";
import { Client, GatewayIntentBits, Options } from "discord.js";
import { ClusterClient, getInfo } from "discord-hybrid-sharding";
import { config } from "../config/config.js";
import { getPool, getRedis, hydrateAll, teardown } from "../db/index.js";
import { startWebhookServer } from "../server/server.js";
import {
	installSessionResumePatch,
	MusicManager,
	warmSessionCache,
} from "../structures/music/index.js";
import { logger } from "../utils/logger.js";
import { CommandHandler } from "./CommandHandler.js";
import { EventLoader } from "./EventLoader.js";
import { persistGatewaySessionInfo, retrieveGatewaySessionInfo } from "./gatewaySession.js";
import { MusicEventLoader } from "./MusicEventLoader.js";

interface ResumableWebSocketOptions extends WebSocketOptions {
	retrieveSessionInfo(shardId: number): Promise<SessionInfo | null>;
	updateSessionInfo(shardId: number, sessionInfo: SessionInfo | null): void;
}

const resumableWsOptions: ResumableWebSocketOptions = {
	retrieveSessionInfo: (shardId) => retrieveGatewaySessionInfo(shardId),
	updateSessionInfo: (shardId, sessionInfo) => void persistGatewaySessionInfo(shardId, sessionInfo),
};

/** @internal */
function resolveShardOptions(): { shards: number[]; shardCount: number } | null {
	try {
		const info = getInfo();
		return { shards: info.SHARD_LIST, shardCount: info.TOTAL_SHARDS };
	} catch {
		return null;
	}
}

export class BotClient extends Client {
	public readonly commands: CommandHandler;
	public readonly events: EventLoader;
	public readonly musicEvents: MusicEventLoader;
	public readonly music: MusicManager;
	public readonly cluster: ClusterClient<BotClient> | null;

	constructor() {
		const shardOptions = resolveShardOptions();

		super({
			...(shardOptions ?? {}),
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.GuildVoiceStates,
			],
			allowedMentions: { parse: [], repliedUser: false },
			failIfNotExists: false,

			ws: resumableWsOptions,

			makeCache: Options.cacheWithLimits({
				...Options.DefaultMakeCacheSettings,
				MessageManager: 0,
				ThreadManager: 0,
				ThreadMemberManager: 0,
				ReactionManager: 0,
				ReactionUserManager: 0,
				PresenceManager: 0,
				StageInstanceManager: 0,
				GuildBanManager: 0,
				GuildInviteManager: 0,
				ApplicationCommandManager: 0,
				BaseGuildEmojiManager: 0,
				GuildStickerManager: 0,
				AutoModerationRuleManager: 0,
				GuildScheduledEventManager: 0,
				UserManager: {
					maxSize: 10,
					keepOverLimit: (user) => user.id === user.client.user?.id,
				},
				GuildMemberManager: {
					maxSize: 50,
					keepOverLimit: (member) =>
						member.voice?.channelId != null || member.id === member.client.user?.id,
				},
				VoiceStateManager: {
					maxSize: 50,
					keepOverLimit: (vs) => vs.channelId != null,
				},
			}),
			sweepers: {
				...Options.DefaultSweeperSettings,
				users: {
					interval: 300, // 5 minutes
					filter: () => (user) => user.id !== user.client.user?.id,
				},
				guildMembers: {
					interval: 300,
					filter: () => (member) =>
						member.voice?.channelId == null && member.id !== member.client.user?.id,
				},
			},
		});

		this.cluster = shardOptions ? new ClusterClient(this) : null;
		this.commands = new CommandHandler();
		this.events = new EventLoader(this);
		this.musicEvents = new MusicEventLoader(this);
		this.music = new MusicManager(this, {
			nodes: config.lavalink.nodes,
			shoukaku: config.lavalink.options,
			defaultVolume: 100,
			clusterId: this.cluster?.id ?? 0,
		});

		if (!shardOptions) {
			logger.warn("Bot", "Not running in cluster mode");
		}
	}

	async start(): Promise<void> {
		getPool();
		getRedis();

		if ((this.cluster?.id ?? 0) === 0) {
			await hydrateAll();
			startWebhookServer();
		} else {
			logger.info("Bot", `Cluster ${this.cluster?.id} skipping hydration — Redis already warm`);
		}

		await this.events.load();
		await this.commands.load();
		await this.musicEvents.load();

		const clusterId = this.cluster?.id ?? 0;
		await warmSessionCache(
			clusterId,
			config.lavalink.nodes.map((n) => n.name),
		);
		installSessionResumePatch();

		await this.login(config.token);
	}

	async shutdown(): Promise<void> {
		logger.warn("Bot", "Shutting down");
		await this.music.destroyAll();
		await teardown();
		this.destroy();
	}

	restart(): Promise<void> {
		logger.warn("Bot", "Restarting (leaving voice, players, and gateway session live for resume)");
		return this.music.prepareForRestart().then(() => teardown());
	}
}
