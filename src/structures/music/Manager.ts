import { clearInterval, setInterval } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { getInfo } from "discord-hybrid-sharding";
import type { LavalinkResponse, NodeOption, ShoukakuOptions, Track } from "shoukaku";
import { Connectors, Constants, LoadType, Shoukaku } from "shoukaku";
import type { BotClient } from "../../core/BotClient.js";
import { ensureGuild } from "../../db/stores/guild.js";
import { logger } from "../../utils/logger.js";
import { TypedEventEmitter } from "../../utils/TypedEventEmitter.js";
import { ManagerError } from "./errors.js";
import type { ManagerEvents } from "./events.js";
import { Player } from "./Player.js";
import {
	clearPlayerSnapshot,
	loadAllSnapshotGuildIds,
	loadPlayerSnapshot,
	type PlayerSnapshotData,
	savePlayerSnapshot,
} from "./persistence.js";
import type { QueueOptions } from "./Queue.js";
import { persistSessionId } from "./session.js";
import type {
	CreatePlayerOptions,
	LavaSearchEntry,
	LavaSearchResult,
	LavaSearchResultType,
	LavaSearchSource,
	PartialQueueTrack,
	SearchResultNormalized,
} from "./types.js";
import { SearchSource } from "./types.js";
import { buildSearchIdentifier, calcShardId } from "./utils.js";

/** Raw `/v4/loadsearch` wire shapes — internal only, never exposed outside Manager. */
interface RawLavaTrack {
	readonly encoded: string;
	readonly info: Track["info"];
	readonly pluginInfo?: unknown;
}
interface RawLavaEntry {
	readonly info: { readonly name: string; readonly selectedTrack: number };
	readonly pluginInfo?: unknown;
}
interface RawLavaSearchResponse {
	readonly tracks?: RawLavaTrack[];
	readonly albums?: RawLavaEntry[];
	readonly artists?: RawLavaEntry[];
	readonly playlists?: RawLavaEntry[];
}

export interface ManagerOptions {
	readonly nodes: ReadonlyArray<NodeOption>;
	readonly shoukaku?: ShoukakuOptions;
	readonly queueOptions?: QueueOptions;
	readonly defaultVolume?: number;
	readonly clusterId?: number;
}

export class Manager extends TypedEventEmitter<ManagerEvents> {
	public readonly shoukaku: Shoukaku;
	public readonly players: ReadonlyMap<string, Player>;

	private readonly _players: Map<string, Player> = new Map();
	private readonly _creating: Set<string> = new Set();
	private readonly _client: BotClient;
	private readonly _queueOptions: QueueOptions | undefined;
	private readonly _defaultVolume: number;
	private readonly _nodeConfigs: Map<string, NodeOption> = new Map();
	private readonly _clusterId: number;
	private _reconcileTimer: ReturnType<typeof setInterval> | null = null;
	private _lastSessionPersist: Promise<unknown> = Promise.resolve();

	public constructor(client: BotClient, options: ManagerOptions) {
		super();
		this._client = client;
		this._queueOptions = options.queueOptions;
		this._defaultVolume = options.defaultVolume ?? 100;
		this._clusterId = options.clusterId ?? 0;

		for (const node of options.nodes) this._nodeConfigs.set(node.name, node);

		this.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), [...options.nodes], {
			moveOnDisconnect: true,
			resumeByLibrary: true,
			...options.shoukaku,
		});

		this.players = this._players;

		this._wireNodeEvents();
		this._startReconciliation();
	}

	public async createPlayer(options: CreatePlayerOptions): Promise<Player> {
		const { guildId } = options;
		const guildSettings = await ensureGuild(guildId);

		if (this._players.has(guildId) || this._creating.has(guildId)) {
			throw new ManagerError("PLAYER_EXISTS", `A player already exists for guild ${guildId}`);
		}
		if (this.shoukaku.connections.has(guildId)) {
			throw new ManagerError(
				"PLAYER_EXISTS",
				`A voice connection already exists for guild ${guildId}`,
			);
		}
		this._creating.add(guildId);

		try {
			const shardId = calcShardId(guildId, this._getTotalShards());
			let volume = guildSettings.defaultVolume ?? this._defaultVolume;
			if (options.volume) volume = options.volume;

			let shoukakuPlayer: Awaited<ReturnType<Shoukaku["joinVoiceChannel"]>>;
			try {
				shoukakuPlayer = await this.shoukaku.joinVoiceChannel({
					guildId,
					channelId: options.voiceChannelId,
					shardId,
					deaf: options.deaf ?? true,
					mute: options.mute ?? false,
				});
			} catch (err) {
				throw new ManagerError(
					"JOIN_FAILED",
					`Failed to join voice channel for guild ${guildId}: ${(err as Error).message}`,
				);
			}

			await shoukakuPlayer.setGlobalVolume(volume).catch(() => undefined);
			const player = new Player(shoukakuPlayer, options, this, this._queueOptions);

			this._players.set(guildId, player);
			this._emitEvent("playerCreate", player);
			if (guildSettings.fairplayDefault) player.setFairplay(true);
			if (guildSettings.autoplayDefault) player.setAutoplay(true);
			return player;
		} finally {
			this._creating.delete(guildId);
		}
	}

	public async destroyPlayer(guildId: string): Promise<void> {
		const player = this._players.get(guildId);
		if (player === undefined) {
			logger.warn("Manager", `destroyPlayer called for ${guildId} but no player exists`);
			return;
		}
		const snap = player.snapshot();

		this._players.delete(guildId);
		this._emitEvent("playerDestroy", player, snap);

		player.destroyInternal();

		try {
			await this.shoukaku.leaveVoiceChannel(guildId);
		} catch (err) {
			logger.warn(
				"Manager",
				`Failed to fully leave voice channel for guild ${guildId}: ${(err as Error).message}`,
			);
		}
	}

	public async destroyAll(): Promise<void> {
		const guildIds = [...this._players.keys()];
		await Promise.allSettled(guildIds.map((id) => this.destroyPlayer(id)));
		this._stopReconciliation();
	}

	public async prepareForRestart(): Promise<void> {
		this._stopReconciliation();
		const players = [...this._players.values()];
		logger.info(
			"Manager",
			`PrepareForRestart: flushing snapshots for ${players.length} active player(s)`,
		);

		const results = await Promise.allSettled(
			players.map((p) => savePlayerSnapshot(p).catch(() => undefined)),
		);
		await this._lastSessionPersist;

		const failed = results.filter((r) => r.status === "rejected").length;
		if (failed > 0) {
			logger.warn(
				"Manager",
				`PrepareForRestart: ${failed}/${players.length} snapshot flush(es) failed`,
			);
		}
	}

	private readonly _resuming: Map<string, Promise<Player | null>> = new Map();

	public isResuming(guildId: string): boolean {
		return this._resuming.has(guildId);
	}

	public async getPlayerAwaitingResume(guildId: string): Promise<Player | undefined> {
		const existing = this._players.get(guildId);
		if (existing) return existing;

		const pending = this._resuming.get(guildId);
		if (!pending) return undefined;

		const result = await pending;
		return result ?? undefined;
	}

	public async resumeAllFromSnapshots(): Promise<void> {
		const guildIds = await loadAllSnapshotGuildIds();
		if (guildIds.length === 0) return;

		logger.info("Manager", `Found ${guildIds.length} player snapshot(s), attempting reattachment`);

		const tasks = guildIds.map((guildId) => {
			const attempt = (async (): Promise<Player | null> => {
				try {
					const snapshot = await loadPlayerSnapshot(guildId);
					if (!snapshot) return null;
					return await this.reattachPlayer(guildId, snapshot);
				} finally {
					this._resuming.delete(guildId);
				}
			})();
			this._resuming.set(guildId, attempt);
			return attempt;
		});

		const results = await Promise.allSettled(tasks);

		const failed = results.filter((r) => r.status === "rejected").length;
		if (failed > 0) {
			logger.warn("Manager", `${failed} player reattachment(s) failed`);
		}
	}
	public async reattachPlayer(
		guildId: string,
		snapshot: PlayerSnapshotData,
	): Promise<Player | null> {
		if (this._players.has(guildId) || this._creating.has(guildId)) {
			return this._players.get(guildId) ?? null;
		}
		this._creating.add(guildId);

		try {
			const shardId = calcShardId(guildId, this._getTotalShards());

			let shoukakuPlayer: Awaited<ReturnType<Shoukaku["joinVoiceChannel"]>>;
			try {
				shoukakuPlayer = await this.shoukaku.joinVoiceChannel({
					guildId,
					channelId: snapshot.voiceChannelId,
					shardId,
					deaf: true,
				});
			} catch (err) {
				logger.warn(
					"Manager",
					`Reattach: failed to rejoin voice for guild ${guildId}: ${(err as Error).message}`,
				);
				await clearPlayerSnapshot(guildId);
				return null;
			}

			let live: Awaited<ReturnType<typeof shoukakuPlayer.node.rest.getPlayer>>;
			const retryDelaysMs = [0, 250, 750];
			live = undefined;
			for (const delayMs of retryDelaysMs) {
				// biome-ignore lint/performance/noAwaitInLoops: required
				if (delayMs > 0) await delay(delayMs);
				try {
					live = await shoukakuPlayer.node.rest.getPlayer(guildId);
				} catch {
					live = undefined;
				}
				if (live?.track) break;
			}

			if (!live?.track) {
				logger.warn(
					"Manager",
					`Reattach: no live Lavalink player for guild ${guildId} after ${retryDelaysMs.length} attempt(s) (resume window likely expired) — dropping snapshot`,
				);
				await this.shoukaku.leaveVoiceChannel(guildId).catch(() => undefined);
				await clearPlayerSnapshot(guildId);
				return null;
			}

			if (snapshot.currentTrack && snapshot.currentTrack.encoded !== live.track.encoded) {
				logger.warn(
					"Manager",
					`Reattach: live encoded differs from snapshot for guild ${guildId}, trusting snapshot anyway (Lavalink re-stamped the track on resume)`,
				);
			}
			if (live.filters && Object.keys(live.filters).length > 0) {
				try {
					await shoukakuPlayer.setFilters(live.filters);
				} catch (err) {
					logger.warn(
						"Manager",
						`Reattach: failed to resync filters for guild ${guildId}: ${(err as Error).message}`,
					);
				}
			}

			const player = new Player(
				shoukakuPlayer,
				{
					guildId,
					voiceChannelId: snapshot.voiceChannelId,
					textChannelId: snapshot.textChannelId ?? undefined,
				},
				this,
				this._queueOptions,
			);

			const currentTrack = snapshot.currentTrack ?? null;

			player.hydrate({
				currentTrack,
				queue: snapshot.queue,
				history: snapshot.history,
				loop: snapshot.loop,
				fairplay: snapshot.fairplay,
				autoplay: snapshot.autoplay,
			});

			player.hydrateTimestamps(snapshot.timestamps);
			player.hydrateData(snapshot.data);

			this._players.set(guildId, player);
			this._emitEvent("playerCreate", player);
			logger.success(
				"Manager",
				`Reattached guild ${guildId} | track="${currentTrack?.info.title ?? "unknown"}"`,
			);
			return player;
		} finally {
			this._creating.delete(guildId);
		}
	}

	public getPlayer(guildId: string): Player | undefined {
		return this._players.get(guildId);
	}

	public hasPlayer(guildId: string): boolean {
		return this._players.has(guildId);
	}

	private static _pluginInfo(raw: Track["pluginInfo"]): Record<string, unknown> {
		if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
			return raw as Record<string, unknown>;
		}
		return {};
	}

	public async search(
		query: string,
		source: SearchSource = SearchSource.Spotify,
		nodeName?: string,
	): Promise<SearchResultNormalized> {
		const identifier = buildSearchIdentifier(query, source);

		const node = nodeName ? this.shoukaku.nodes.get(nodeName) : this.shoukaku.getIdealNode();

		if (node === undefined || node.state !== Constants.State.CONNECTED) {
			throw new ManagerError("NO_NODES", "No connected Lavalink nodes available");
		}

		const base = { source, query, identifier } as const;

		let result: LavalinkResponse | undefined;
		try {
			result = await node.rest.resolve(identifier);
		} catch (err) {
			throw new ManagerError("SEARCH_FAILED", `Search failed: ${(err as Error).message}`);
		}

		if (result === undefined || result.loadType === LoadType.EMPTY) {
			return { ...base, type: "empty", tracks: [], playlistName: null };
		}

		if (result.loadType === LoadType.ERROR) {
			return { ...base, type: "error", tracks: [], playlistName: null, exception: result.data };
		}

		if (result.loadType === LoadType.TRACK) {
			const partial: PartialQueueTrack = {
				encoded: result.data.encoded,
				info: result.data.info,
				pluginInfo: Manager._pluginInfo(result.data.pluginInfo),
			};
			return { ...base, type: "track", tracks: [partial], playlistName: null };
		}

		if (result.loadType === LoadType.PLAYLIST) {
			const tracks: PartialQueueTrack[] = result.data.tracks.map((t) => ({
				encoded: t.encoded,
				info: t.info,
				pluginInfo: Manager._pluginInfo(t.pluginInfo),
			}));
			return {
				...base,
				type: "playlist",
				tracks,
				playlistName: result.data.info.name,
				selectedTrack: result.data.info.selectedTrack,
			};
		}

		// SEARCH
		const tracks: PartialQueueTrack[] = result.data.map((t) => ({
			encoded: t.encoded,
			info: t.info,
			pluginInfo: Manager._pluginInfo(t.pluginInfo),
		}));
		return { ...base, type: "search", tracks, playlistName: null };
	}

	public async lavaSearch(
		query: string,
		source: LavaSearchSource,
		types: readonly LavaSearchResultType[] = ["track", "album", "artist", "playlist"],
		nodeName?: string,
	): Promise<LavaSearchResult> {
		const node = nodeName ? this.shoukaku.nodes.get(nodeName) : this.shoukaku.getIdealNode();

		if (node === undefined || node.state !== Constants.State.CONNECTED) {
			throw new ManagerError("NO_NODES", "No connected Lavalink nodes available");
		}

		const config = this._nodeConfigs.get(node.name);
		if (config === undefined) {
			throw new ManagerError("SEARCH_FAILED", `No stored configuration for node ${node.name}`);
		}

		const protocol = config.secure ? "https" : "http";
		const identifier = encodeURIComponent(`${source}:${query}`);
		const typeParam = encodeURIComponent(types.join(","));
		const url = `${protocol}://${config.url}/v4/loadsearch?query=${identifier}&types=${typeParam}`;

		let res: Response;
		try {
			res = await fetch(url, { headers: { Authorization: config.auth } });
		} catch (err) {
			throw new ManagerError(
				"SEARCH_FAILED",
				`LavaSearch request failed: ${(err as Error).message}`,
			);
		}

		const empty: LavaSearchResult = {
			source,
			query,
			tracks: [],
			albums: [],
			artists: [],
			playlists: [],
		};
		if (res.status === 204) return empty;

		if (!res.ok) {
			throw new ManagerError("SEARCH_FAILED", `LavaSearch responded with status ${res.status}`);
		}

		let raw: RawLavaSearchResponse;
		try {
			raw = (await res.json()) as RawLavaSearchResponse;
		} catch (err) {
			throw new ManagerError(
				"SEARCH_FAILED",
				`Failed to parse LavaSearch response: ${(err as Error).message}`,
			);
		}

		return {
			source,
			query,
			tracks: (raw.tracks ?? []).filter(Manager._isUsableTrack).map((t) => ({
				encoded: t.encoded,
				info: t.info,
				pluginInfo: Manager._pluginInfo(t.pluginInfo),
			})),
			albums: (raw.albums ?? []).filter(Manager._isUsableEntry).map(Manager._normalizeEntry),
			artists: (raw.artists ?? []).filter(Manager._isUsableEntry).map(Manager._normalizeEntry),
			playlists: (raw.playlists ?? []).filter(Manager._isUsableEntry).map(Manager._normalizeEntry),
		};
	}

	private static _isUsableTrack(track: RawLavaTrack): boolean {
		const title = track.info?.title?.trim() ?? "";
		const author = track.info?.author?.trim() ?? "";
		return title.length > 0 && author.length > 0 && title.toLowerCase() !== "unknown";
	}

	private static _isUsableEntry(entry: RawLavaEntry): boolean {
		const name = entry.info?.name?.trim() ?? "";
		const pluginInfo = entry.pluginInfo as Record<string, unknown> | undefined;
		const url = (pluginInfo?.url as string | undefined)?.trim() ?? "";
		return name.length > 0 && url.length > 0 && name.toLowerCase() !== "unknown";
	}

	private static _normalizeEntry(entry: RawLavaEntry): LavaSearchEntry {
		const pluginInfo = Manager._pluginInfo(entry.pluginInfo);
		return {
			name: entry.info.name,
			url: (pluginInfo.url as string | undefined) ?? null,
			author: (pluginInfo.author as string | undefined) ?? null,
			totalTracks: (pluginInfo.totalTracks as number | undefined) ?? null,
			artworkUrl: (pluginInfo.artworkUrl as string | undefined) ?? null,
		};
	}

	private _wireNodeEvents(): void {
		this.shoukaku.on("ready", (name, lavalinkResume, libraryResume) => {
			logger.success(
				"Music",
				`Node ${name} ready | lavalinkResume=${lavalinkResume} libraryResume=${libraryResume}`,
			);

			const sessionId = this.shoukaku.nodes.get(name)?.sessionId;
			if (sessionId) {
				this._lastSessionPersist = persistSessionId(this._clusterId, name, sessionId).catch(
					(err: unknown) => {
						logger.warn(
							"Manager",
							`Failed to persist session id for node ${name}: ${(err as Error).message}`,
						);
					},
				);
			}

			this._emitEvent("nodeReady", name, lavalinkResume, libraryResume);
		});

		this.shoukaku.on("error", (name, error) => {
			logger.error("Music", `Node ${name} error`, error);
			this._emitEvent("nodeError", name, error);
		});

		this.shoukaku.on("disconnect", (name, count) => {
			logger.warn("Music", `Node ${name} disconnected | players moved: ${count}`);
			this._emitEvent("nodeDisconnect", name, count);
		});

		this.shoukaku.on("reconnecting", (name, triesLeft, interval) => {
			logger.warn(
				"Music",
				`Node ${name} reconnecting | triesLeft=${triesLeft} interval=${interval}s`,
			);
			this._emitEvent("nodeReconnect", name, triesLeft, interval);
		});

		this.shoukaku.on("debug", (name, info) => {
			logger.debug(`Music:${name}`, info);
		});
	}

	private _startReconciliation(intervalMs = 30_000): void {
		this._reconcileTimer = setInterval(() => {
			this._reconcile();
		}, intervalMs);
		this._reconcileTimer.unref?.();
	}

	private _stopReconciliation(): void {
		if (this._reconcileTimer !== null) {
			clearInterval(this._reconcileTimer);
			this._reconcileTimer = null;
		}
	}

	private _reconcile(): void {
		const graceMs = 60_000;
		const now = Date.now();
		for (const [guildId, player] of this._players) {
			if (now - player.timestamps.createdAt < graceMs) continue;
			const hasConnection = this.shoukaku.connections.has(guildId);
			const hasShoukakuPlayer = this.shoukaku.players.has(guildId);
			if (hasConnection && hasShoukakuPlayer) continue;

			logger.warn(
				"Manager",
				`Reconciling orphaned player for guild ${guildId} (Shoukaku connection or player missing underneath us)`,
			);
			this._players.delete(guildId);
			const snap = player.snapshot();
			player.destroyInternal();
			this._emitEvent("playerDestroy", player, snap);
			void this.shoukaku.leaveVoiceChannel(guildId).catch(() => undefined);
		}
	}

	private _getTotalShards(): number {
		try {
			return getInfo().TOTAL_SHARDS;
		} catch {
			// Not using hybrid sharding — fall back to discord.js shard info
		}
		const count = this._client.options.shardCount;
		if (typeof count === "number" && count > 0) return count;
		return this._client.ws.shards.size || 1;
	}

	private _emitEvent<K extends keyof ManagerEvents>(event: K, ...args: ManagerEvents[K]): void {
		this.emit(event, ...args);
	}
}
