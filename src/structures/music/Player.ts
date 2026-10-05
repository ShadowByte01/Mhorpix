import { clearTimeout, setTimeout } from "node:timers";
import type {
	Band,
	ChannelMixSettings,
	DistortionSettings,
	Exception,
	FilterOptions,
	FreqSettings,
	KaraokeSettings,
	LowPassSettings,
	PlayerUpdate,
	RotationSettings,
	Player as ShoukakuPlayer,
	TimescaleSettings,
	TrackEndReason,
	UpdatePlayerOptions,
	WebSocketClosedEvent,
} from "shoukaku";
import { TypedEventEmitter } from "../../utils/TypedEventEmitter.js";
import { AsyncLock } from "./AsyncLock.js";
import { PlayerError } from "./errors.js";

export type PlayerLocalEvents = Record<string, unknown[]>;

import type { ManagerEvents } from "./events.js";
import type { QueueOptions } from "./Queue.js";
import { Queue } from "./Queue.js";
import type {
	CreatePlayerOptions,
	LoopMode,
	PlayerSnapshot,
	PlayerTimestamps,
	QueueTrack,
} from "./types.js";
import { LoopMode as LoopModeConst } from "./types.js";

type TrackEventData = { track: { encoded: string } };
type EndEventData = { reason: TrackEndReason };
type ExceptionEventData = { track: { encoded: string }; exception: Exception };
export interface PlayerDataStore {
	set<T>(key: string, value: T): void;
	get<T>(key: string): T | undefined;
	getOrSet<T>(key: string, factory: () => T): T;
	del(key: string): boolean;
	has(key: string): boolean;
	size(): number;
	getAll(): ReadonlyMap<string, unknown>;
	delAll(): void;
}

const makeDataStore = (): PlayerDataStore => {
	const _map = new Map<string, unknown>();
	return {
		set: <T>(key: string, value: T) => {
			_map.set(key, value);
		},
		get: <T>(key: string) => _map.get(key) as T | undefined,
		getOrSet: <T>(key: string, factory: () => T): T => {
			if (_map.has(key)) return _map.get(key) as T;
			const value = factory();
			_map.set(key, value);
			return value;
		},
		del: (key: string) => _map.delete(key),
		has: (key: string) => _map.has(key),
		size: () => _map.size,
		getAll: () => _map as ReadonlyMap<string, unknown>,
		delAll: () => {
			_map.clear();
		},
	};
};

export class Player extends TypedEventEmitter<PlayerLocalEvents> {
	public readonly guildId: string;
	public readonly queue: Queue;
	public readonly timestamps: PlayerTimestamps;
	public readonly data: PlayerDataStore;
	public readonly shoukaku: ShoukakuPlayer;

	private _currentTrack: QueueTrack | null = null;
	private _textChannelId: string | null;
	private _cachedVoiceChannelId: string;
	private _destroyed = false;
	private _advanceTimer: ReturnType<typeof setTimeout> | null = null;
	private _advanceGeneration = 0;
	private _autoplay = false;

	private readonly _transitionLock = new AsyncLock();
	private readonly _manager: TypedEventEmitter<ManagerEvents>;

	public constructor(
		shoukaku: ShoukakuPlayer,
		options: CreatePlayerOptions,
		manager: TypedEventEmitter<ManagerEvents>,
		queueOptions?: QueueOptions,
	) {
		super();
		this.guildId = options.guildId;
		this._textChannelId = options.textChannelId ?? null;
		this._cachedVoiceChannelId = options.voiceChannelId;
		this.shoukaku = shoukaku;
		this._manager = manager;
		this.queue = new Queue(queueOptions);
		this.data = makeDataStore();
		this.timestamps = {
			createdAt: Date.now(),
			lastTrackStartedAt: null,
			lastQueueUpdatedAt: null,
			lastSeekedAt: null,
			lastVolumeChangedAt: null,
			lastPlayStateChangedAt: null,
			lastLoopChangedAt: null,
			lastFairplayChangedAt: null,
		};
		this._wireShoukakuEvents();
	}

	public get currentTrack(): QueueTrack | null {
		return this._currentTrack;
	}

	public get volume(): number {
		return this.shoukaku.volume;
	}

	public get paused(): boolean {
		return this.shoukaku.paused;
	}

	public get position(): number {
		return this.shoukaku.position;
	}

	public get ping(): number {
		return this.shoukaku.ping;
	}

	public get destroyed(): boolean {
		return this._destroyed;
	}

	public get hasCurrentTrack(): boolean {
		return this._currentTrack !== null;
	}

	public get voiceChannelId(): string {
		const live = this.shoukaku.node.manager.connections.get(this.guildId)?.channelId;
		if (live) {
			if (live !== this._cachedVoiceChannelId) this._cachedVoiceChannelId = live;
			return live;
		}
		return this._cachedVoiceChannelId;
	}

	public get currentTextChannelId(): string | null {
		return this._textChannelId;
	}

	public getAutoplay(): boolean {
		return this._autoplay;
	}

	public setAutoplay(enabled: boolean): void {
		this._assertAlive();
		this._autoplay = enabled;
	}

	public hydrate(data: {
		readonly currentTrack: QueueTrack | null;
		readonly queue: readonly QueueTrack[];
		readonly history: readonly QueueTrack[];
		readonly loop: LoopMode;
		readonly fairplay: boolean;
		readonly autoplay: boolean;
	}): void {
		this._currentTrack = data.currentTrack;
		this.queue.hydrate(data.queue, data.history, data.loop, data.fairplay);
		this._autoplay = data.autoplay;
		this.timestamps.lastQueueUpdatedAt = Date.now();
	}

	public hydrateData(entries: Readonly<Record<string, unknown>> | undefined): void {
		if (!entries) return;
		for (const [key, value] of Object.entries(entries)) {
			this.data.set(key, value);
		}
	}

	/** Restores everything except `createdAt` */
	public hydrateTimestamps(timestamps: Partial<PlayerTimestamps> | undefined): void {
		if (!timestamps) return;
		const { createdAt: _ignored, ...rest } = timestamps;
		Object.assign(this.timestamps, rest);
	}

	public snapshot(): Readonly<PlayerSnapshot> {
		return Object.freeze({
			guildId: this.guildId,
			textChannelId: this._textChannelId,
			voiceChannelId: this.voiceChannelId,
			currentTrack: this._currentTrack,
			position: this.shoukaku.position,
			volume: this.shoukaku.volume,
			paused: this.shoukaku.paused,
		});
	}

	public setTextChannel(channelId: string | null): void {
		this._textChannelId = channelId;
	}

	public updateVoiceChannel(channelId: string): void {
		this._cachedVoiceChannelId = channelId;
	}

	public setLoop(mode: LoopMode): void {
		this.queue.setLoop(mode);
		this.timestamps.lastLoopChangedAt = Date.now();
	}

	public getLoop(): LoopMode {
		return this.queue.getLoop();
	}

	public isFairplay(): boolean {
		return this.queue.getFairplay();
	}

	public setFairplay(enabled: boolean): void {
		this._assertAlive();
		this.queue.setFairplay(enabled);
		this.timestamps.lastFairplayChangedAt = Date.now();
	}

	public add(tracks: QueueTrack | QueueTrack[], position?: number): void {
		this._assertAlive();
		this.queue.add(tracks, position);
		this.timestamps.lastQueueUpdatedAt = Date.now();
	}

	public remove(index: number): QueueTrack;
	public remove(indexes: number[]): QueueTrack[];
	public remove(indexOrIndexes: number | number[]): QueueTrack | QueueTrack[] {
		this._assertAlive();
		const track = Array.isArray(indexOrIndexes)
			? this.queue.remove(indexOrIndexes)
			: this.queue.remove(indexOrIndexes);
		this.timestamps.lastQueueUpdatedAt = Date.now();
		return track;
	}

	public move(from: number, to: number): void {
		this._assertAlive();
		this.queue.move(from, to);
		this.timestamps.lastQueueUpdatedAt = Date.now();
	}

	public swap(a: number, b: number): void {
		this._assertAlive();
		this.queue.swap(a, b);
		this.timestamps.lastQueueUpdatedAt = Date.now();
	}

	public shuffle(): void {
		this._assertAlive();
		this.queue.shuffle();
		this.timestamps.lastQueueUpdatedAt = Date.now();
	}

	public reverse(): void {
		this._assertAlive();
		this.queue.reverse();
		this.timestamps.lastQueueUpdatedAt = Date.now();
	}

	public clearQueue(): void {
		this._assertAlive();
		this.queue.clear();
		this.timestamps.lastQueueUpdatedAt = Date.now();
	}
	private _applyTransition(
		track: QueueTrack | undefined,
		removeFromQueue: boolean | undefined,
	): {
		target: QueueTrack;
		previousTrack: QueueTrack | null;
		consumedFromQueue: boolean;
		removedIdx: number;
	} {
		const target = track ?? this.queue.peek();
		if (target === undefined) {
			throw new PlayerError("QUEUE_EMPTY", "No track provided and queue is empty");
		}

		const previousTrack = this._currentTrack;
		const consumedFromQueue = track === undefined;
		let removedIdx = -1;

		if (previousTrack !== null) this.queue.recordHistory(previousTrack);

		if (consumedFromQueue) {
			this.queue.next();
		} else if (removeFromQueue) {
			removedIdx = this.queue.indexByEncoded(target.encoded);
			if (removedIdx !== -1) this.queue.remove(removedIdx);
		}

		this._currentTrack = target;
		this._clearAdvanceTimer();
		this._advanceGeneration++;
		this.timestamps.lastQueueUpdatedAt = Date.now();

		return { target, previousTrack, consumedFromQueue, removedIdx };
	}

	private _rollbackTransition(
		target: QueueTrack,
		previousTrack: QueueTrack | null,
		consumedFromQueue: boolean,
		removedIdx: number,
	): void {
		this._currentTrack = previousTrack;
		if (consumedFromQueue) {
			this.queue.add(target, 0);
		} else if (removedIdx !== -1) {
			this.queue.add(target, removedIdx);
		}
		if (previousTrack !== null) this.queue.popHistory();
	}

	public async play(
		track?: QueueTrack,
		options?: Omit<UpdatePlayerOptions, "filters" | "voice" | "track"> & {
			removeFromQueue?: boolean;
		},
	): Promise<void> {
		this._assertAlive();
		return this._transitionLock.run(async () => {
			this._assertAlive();
			const { removeFromQueue, ...playOptions } = options ?? {};
			const { target, previousTrack, consumedFromQueue, removedIdx } = this._applyTransition(
				track,
				removeFromQueue,
			);

			try {
				await this.shoukaku.playTrack({
					...playOptions,
					track: { encoded: target.encoded },
				});
			} catch (err) {
				this._rollbackTransition(target, previousTrack, consumedFromQueue, removedIdx);
				throw new PlayerError(
					"PLAY_FAILED",
					`Failed to start playback for guild ${this.guildId}: ${(err as Error).message}`,
				);
			}
		});
	}

	public async skip(count = 1): Promise<QueueTrack | undefined> {
		this._assertAlive();
		if (count < 1) throw new PlayerError("INVALID_INDEX", "Skip count must be at least 1");

		return this._transitionLock.run(async () => {
			this._assertAlive();

			const loop = this.queue.getLoop();
			for (let i = 1; i < count; i++) {
				const discarded = this.queue.next();
				if (discarded === undefined) break;
				if (loop === LoopModeConst.Queue) this.queue.add(discarded);
			}
			this.timestamps.lastQueueUpdatedAt = Date.now();

			try {
				await this._advanceInternal(true);
			} catch (err) {
				this._emitManager("error", this, err as Error);
				throw new PlayerError(
					"PLAY_FAILED",
					`Skip failed for guild ${this.guildId}: ${(err as Error).message}`,
				);
			}

			return this._currentTrack ?? undefined;
		});
	}

	public async previous(): Promise<QueueTrack | undefined> {
		this._assertAlive();

		return this._transitionLock.run(async () => {
			this._assertAlive();

			const prev = this.queue.popHistory();
			if (prev === undefined) return undefined;

			const displaced = this._currentTrack;

			this._currentTrack = prev;
			this._clearAdvanceTimer();
			this._advanceGeneration++;

			if (displaced !== null) this.queue.add(displaced, 0);
			this.timestamps.lastQueueUpdatedAt = Date.now();

			try {
				await this.shoukaku.playTrack({ track: { encoded: prev.encoded } });
			} catch (err) {
				// Rollback
				this._currentTrack = displaced;
				if (displaced !== null) this.queue.remove(0);
				this.queue.recordHistory(prev);
				throw new PlayerError(
					"PLAY_FAILED",
					`Failed to play previous track for guild ${this.guildId}: ${(err as Error).message}`,
				);
			}

			return prev;
		});
	}

	public async stop(): Promise<void> {
		this._assertAlive();
		return this._transitionLock.run(async () => {
			this._assertAlive();
			this._clearAdvanceTimer();
			this._advanceGeneration++;
			this._autoplay = false;
			const snap = this.snapshot();
			this._currentTrack = null;
			this.queue.clear();

			await this.shoukaku.stopTrack();
			this._emitManager("queueFinish", this, snap);
		});
	}

	public async setPaused(paused = true): Promise<void> {
		this._assertAlive();
		await this.shoukaku.setPaused(paused);
		this.timestamps.lastPlayStateChangedAt = Date.now();
	}

	public async seek(position: number): Promise<void> {
		this._assertAlive();
		const track = this._currentTrack;
		if (track === null) throw new PlayerError("NO_TRACK_PLAYING", "No track is currently playing");
		if (track.info.isStream) throw new PlayerError("INVALID_SEEK", "Cannot seek on a livestream");
		const clamped = Math.max(0, Math.min(position, track.info.length));
		await this.shoukaku.seekTo(clamped);
		this.timestamps.lastSeekedAt = Date.now();
	}

	public async setVolume(volume: number): Promise<void> {
		this._assertAlive();
		const clamped = Math.max(0, Math.min(volume, 1000));
		await this.shoukaku.setGlobalVolume(clamped);
		this.timestamps.lastVolumeChangedAt = Date.now();
	}

	public async setFilters(filters: FilterOptions): Promise<void> {
		this._assertAlive();
		await this.shoukaku.setFilters(filters);
	}

	public async clearFilters(): Promise<void> {
		this._assertAlive();
		await this.shoukaku.clearFilters();
	}

	public async setEqualizer(equalizer: Band[]): Promise<void> {
		this._assertAlive();
		await this.shoukaku.setEqualizer(equalizer);
	}

	public async setKaraoke(karaoke?: KaraokeSettings): Promise<void> {
		this._assertAlive();
		await this.shoukaku.setKaraoke(karaoke);
	}

	public async setTimescale(timescale?: TimescaleSettings): Promise<void> {
		this._assertAlive();
		await this.shoukaku.setTimescale(timescale);
	}

	public async setTremolo(tremolo?: FreqSettings): Promise<void> {
		this._assertAlive();
		await this.shoukaku.setTremolo(tremolo);
	}

	public async setVibrato(vibrato?: FreqSettings): Promise<void> {
		this._assertAlive();
		await this.shoukaku.setVibrato(vibrato);
	}

	public async setRotation(rotation?: RotationSettings): Promise<void> {
		this._assertAlive();
		await this.shoukaku.setRotation(rotation);
	}

	public async setDistortion(distortion?: DistortionSettings): Promise<void> {
		this._assertAlive();
		await this.shoukaku.setDistortion(distortion);
	}

	public async setChannelMix(channelMix?: ChannelMixSettings): Promise<void> {
		this._assertAlive();
		await this.shoukaku.setChannelMix(channelMix);
	}

	public async setLowPass(lowPass?: LowPassSettings): Promise<void> {
		this._assertAlive();
		await this.shoukaku.setLowPass(lowPass);
	}

	public destroyInternal(): void {
		if (this._destroyed) return;
		this._destroyed = true;
		this._clearAdvanceTimer();
		this._cleanup();
	}

	public clean(): void {
		this._cleanup();
	}
	private _wireShoukakuEvents(): void {
		this.shoukaku.on("start", (data) => this._onStart(data as unknown as TrackEventData));
		this.shoukaku.on("end", (data) => this._onEnd(data as unknown as EndEventData));
		this.shoukaku.on("stuck", (data) => this._onStuck(data as unknown as TrackEventData));
		this.shoukaku.on("exception", (data) =>
			this._onException(data as unknown as ExceptionEventData),
		);
		this.shoukaku.on("closed", (data) => this._onClosed(data));
		this.shoukaku.on("update", (data) => this._onUpdate(data));
		this.shoukaku.on("resumed", () => this._onResumed());
	}

	private _onStart(data: TrackEventData): void {
		// _currentTrack is always set before playTrack() is called (in _applyTransition
		// and _playNextInQueue), so we only need to reconcile if something is genuinely
		// out of sync — e.g. a node resume replaying a track we already know about.
		// We intentionally do NOT fall back to history here: doing so caused the previous
		// track (or a wrong track) to be reported as current when advancing the queue,
		// because the just-consumed track had already been moved into history.
		if (this._currentTrack !== null && this._currentTrack.encoded !== data.track.encoded) {
			// Encoded mismatch — Lavalink started something we didn't expect (e.g. resumed
			// a different track). Try to find it only in the live queue, not history.
			const matched = this.queue.findByEncoded(data.track.encoded);
			if (matched) this._currentTrack = matched;
		}

		this.timestamps.lastTrackStartedAt = Date.now();
		this.timestamps.lastSeekedAt = null;
		this.timestamps.lastPlayStateChangedAt = null;

		const track = this._currentTrack;
		if (track === null) return;
		this._emitManager("trackStart", this, track, this.snapshot());
	}

	private _onEnd(data: EndEventData): void {
		const { reason } = data;
		const endedTrack = this._currentTrack;
		const snap = this.snapshot();
		this.timestamps.lastSeekedAt = null;

		switch (reason) {
			case "replaced":
				if (endedTrack !== null) this._emitManager("trackEnd", this, endedTrack, reason, snap);
				return;
			case "stopped":
				this._currentTrack = null;
				if (endedTrack !== null) this._emitManager("trackEnd", this, endedTrack, reason, snap);
				return;
			case "cleanup":
				if (endedTrack !== null) this._emitManager("trackEnd", this, endedTrack, reason, snap);
				return;
			default:
				break;
		}

		if (endedTrack !== null) this._emitManager("trackEnd", this, endedTrack, reason, snap);

		if (endedTrack !== null) this._scheduleAdvance();
	}

	private _onStuck(data: TrackEventData): void {
		const track = this._currentTrack;
		if (track === null || track.encoded !== data.track.encoded) return;
		this._emitManager("trackStuck", this, track, this.snapshot());
		this._scheduleAdvance();
	}

	private _onException(data: ExceptionEventData): void {
		const track = this._currentTrack;
		if (track === null || track.encoded !== data.track.encoded) return;
		this._emitManager("trackError", this, track, data.exception, this.snapshot());
		this._scheduleAdvance();
	}

	private _onClosed(data: WebSocketClosedEvent): void {
		this._emitManager("playerClosed", this, data, this.snapshot());
	}

	private _onUpdate(data: PlayerUpdate): void {
		this._emitManager("playerUpdate", this, data);
	}

	private _onResumed(): void {
		this._emitManager("playerResumed", this);
	}

	private _scheduleAdvance(): void {
		this._clearAdvanceTimer();
		const gen = ++this._advanceGeneration;
		this._advanceTimer = setTimeout(() => {
			this._advanceTimer = null;
			if (gen !== this._advanceGeneration) return;
			void this._transitionLock
				.run(() => this._advanceInternal(false))
				.catch((err: unknown) => {
					this._emitManager("error", this, err as Error);
				});
		}, 0);
	}

	private _clearAdvanceTimer(): void {
		if (this._advanceTimer !== null) {
			clearTimeout(this._advanceTimer);
			this._advanceTimer = null;
		}
	}
	private async _advanceInternal(forceAdvance: boolean): Promise<void> {
		if (this._destroyed) return;

		const loop = this.queue.getLoop();

		if (!forceAdvance && loop === LoopModeConst.Track && this._currentTrack !== null) {
			await this._replayCurrentTrack();
			return;
		}

		if (loop === LoopModeConst.Queue && this._currentTrack !== null) {
			this.queue.add(this._currentTrack);
		}

		const next = this.queue.next();
		this.timestamps.lastQueueUpdatedAt = Date.now();

		if (next === undefined) {
			this._handleQueueFinish();
			return;
		}

		await this._playNextInQueue(next);
	}

	private async _replayCurrentTrack(): Promise<void> {
		const track = this._currentTrack;
		this._clearAdvanceTimer();
		this._advanceGeneration++;
		if (track) await this.shoukaku.playTrack({ track: { encoded: track.encoded } });
	}

	private _handleQueueFinish(): void {
		if (this._currentTrack !== null) this.queue.recordHistory(this._currentTrack);
		this._currentTrack = null;
		this._emitManager("queueFinish", this, this.snapshot());
	}

	private async _playNextInQueue(next: QueueTrack): Promise<void> {
		const previousTrack = this._currentTrack;

		this._clearAdvanceTimer();
		this._advanceGeneration++;
		this._currentTrack = next;

		try {
			await this.shoukaku.playTrack({ track: { encoded: next.encoded } });
		} catch (err) {
			this._currentTrack = previousTrack;
			this.queue.add(next, 0);
			throw err;
		}

		if (previousTrack !== null) this.queue.recordHistory(previousTrack);
	}
	private _assertAlive(): void {
		if (this._destroyed) {
			throw new PlayerError("DESTROYED", `Player for guild ${this.guildId} has been destroyed`);
		}
	}

	private _emitManager<K extends keyof ManagerEvents>(event: K, ...args: ManagerEvents[K]): void {
		this._manager.emit(event, ...args);
	}

	private _cleanup(): void {
		this._clearAdvanceTimer();
		this.queue.clear();
		this.queue.clearHistory();
		this.data.delAll();
		this._currentTrack = null;
		this.shoukaku.removeAllListeners();
		this.removeAllListeners();
	}
}
