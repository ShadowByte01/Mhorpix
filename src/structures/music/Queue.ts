import { PlayerError } from "./errors.js";
import type { LoopMode, QueueTrack } from "./types.js";
import { LoopMode as LoopModeConst } from "./types.js";

export interface QueueOptions {
	readonly historyLimit?: number;
	readonly compactThreshold?: number;
	readonly maxQueueSize?: number;
}

export class Queue {
	private _tracks: QueueTrack[] = [];
	private _head = 0;
	private _history: QueueTrack[] = [];
	private _loop: LoopMode = LoopModeConst.None;
	private _fairplay = false;

	private readonly _historyLimit: number;
	private readonly _compactThreshold: number;
	private readonly _maxQueueSize: number;

	public constructor(options: QueueOptions = {}) {
		this._historyLimit = options.historyLimit ?? 5;
		this._compactThreshold = options.compactThreshold ?? 100;
		this._maxQueueSize = options.maxQueueSize ?? 500;
	}

	public get size(): number {
		return this._tracks.length - this._head;
	}

	public get isEmpty(): boolean {
		return this.size === 0;
	}

	public toArray(): readonly QueueTrack[] {
		return this._tracks.slice(this._head);
	}

	public popHistory(): QueueTrack | undefined {
		return this._history.pop();
	}

	public peek(offset = 0): QueueTrack | undefined {
		return this._tracks[this._head + offset];
	}

	public get historySize(): number {
		return this._history.length;
	}

	public getHistory(): readonly QueueTrack[] {
		return [...this._history];
	}

	public peekHistory(): QueueTrack | undefined {
		return this._history[this._history.length - 1];
	}

	public getLoop(): LoopMode {
		return this._loop;
	}

	public setLoop(mode: LoopMode): void {
		this._loop = mode;
	}

	public getFairplay(): boolean {
		return this._fairplay;
	}

	public setFairplay(enabled: boolean): void {
		this._fairplay = enabled;
		if (enabled) this._rebalanceFairplay();
	}

	public add(tracks: QueueTrack | QueueTrack[], position?: number): void {
		const items = Array.isArray(tracks) ? tracks : [tracks];
		if (items.length === 0) return;

		if (this._maxQueueSize > 0 && this.size + items.length > this._maxQueueSize) {
			throw new PlayerError(
				"QUEUE_FULL",
				`Queue is full (max ${this._maxQueueSize} tracks). Remove tracks before adding more.`,
			);
		}

		const frozen = items.map((t) => Object.freeze({ ...t }) as QueueTrack);

		if (position === undefined || position >= this.size) {
			for (const t of frozen) this._tracks.push(t);
		} else {
			const absPos = this._head + Math.max(0, position);
			this._tracks.splice(absPos, 0, ...frozen);
		}

		if (this._fairplay && position === undefined) this._rebalanceFairplay();
	}

	public remove(index: number): QueueTrack;

	public remove(indexes: number[]): QueueTrack[];
	public remove(indexOrIndexes: number | number[]): QueueTrack | QueueTrack[] {
		if (Array.isArray(indexOrIndexes)) {
			if (indexOrIndexes.length === 0) return [];

			const unique = [...new Set(indexOrIndexes)];
			for (const idx of unique) this._assertIndex(idx);
			const descending = [...unique].sort((a, b) => b - a);
			const removed: QueueTrack[] = [];
			for (const idx of descending) {
				const splicedTracks = this._tracks.splice(this._head + idx, 1);
				removed.push(splicedTracks[0] as QueueTrack);
			}
			return removed.reverse();
		}

		this._assertIndex(indexOrIndexes);
		const removed = this._tracks.splice(this._head + indexOrIndexes, 1);
		return removed[0] as QueueTrack;
	}

	public removeBy(predicate: (track: QueueTrack, index: number) => boolean): QueueTrack[] {
		const removed: QueueTrack[] = [];
		let i = this._head;
		while (i < this._tracks.length) {
			const track = this._tracks[i];
			if (track !== undefined && predicate(track, i - this._head)) {
				this._tracks.splice(i, 1);
				removed.push(track);
			} else {
				i++;
			}
		}
		return removed;
	}

	public move(from: number, to: number): void {
		this._assertIndex(from);
		this._assertIndex(to);
		if (from === to) return;
		const absFrom = this._head + from;
		const absTo = this._head + to;
		const track = this._tracks[absFrom] as QueueTrack;
		this._tracks.splice(absFrom, 1);
		this._tracks.splice(absTo, 0, track);
	}

	public swap(a: number, b: number): void {
		this._assertIndex(a);
		this._assertIndex(b);
		if (a === b) return;
		const absA = this._head + a;
		const absB = this._head + b;
		const temp = this._tracks[absA] as QueueTrack;
		this._tracks[absA] = this._tracks[absB] as QueueTrack;
		this._tracks[absB] = temp;
	}

	public shuffle(): void {
		for (let i = this._tracks.length - 1; i > this._head; i--) {
			const j = Math.floor(Math.random() * (i - this._head + 1)) + this._head;
			const temp = this._tracks[i] as QueueTrack;
			this._tracks[i] = this._tracks[j] as QueueTrack;
			this._tracks[j] = temp;
		}
	}

	public reverse(): void {
		const remaining = this._tracks.splice(this._head);
		remaining.reverse();
		this._tracks.push(...remaining);
	}

	public clear(): void {
		this._tracks = [];
		this._head = 0;
	}

	public hydrate(
		tracks: readonly QueueTrack[],
		history: readonly QueueTrack[],
		loop: LoopMode,
		fairplay: boolean,
	): void {
		this._tracks = tracks.map((t) => Object.freeze({ ...t }) as QueueTrack);
		this._head = 0;
		this._history = history
			.slice(-this._historyLimit)
			.map((t) => Object.freeze({ ...t }) as QueueTrack);
		this._loop = loop;
		this._fairplay = fairplay;
	}

	public clearHistory(): void {
		this._history = [];
	}

	public next(): QueueTrack | undefined {
		const track = this._tracks[this._head];
		if (track === undefined) return undefined;

		this._head++;
		this._maybeCompact();
		return track;
	}

	public recordHistory(track: QueueTrack): void {
		this._pushHistory(track);
	}

	public findByEncoded(encoded: string): QueueTrack | undefined {
		return this._slice().find((t) => t.encoded === encoded);
	}

	public findAllByEncoded(encoded: string): QueueTrack[] {
		return this._slice().filter((t) => t.encoded === encoded);
	}

	public findByEncodedStartsWith(prefix: string): QueueTrack | undefined {
		return this._slice().find((t) => t.encoded.startsWith(prefix));
	}

	public findAllByEncodedStartsWith(prefix: string): QueueTrack[] {
		return this._slice().filter((t) => t.encoded.startsWith(prefix));
	}

	public findByEncodedContains(substring: string): QueueTrack | undefined {
		return this._slice().find((t) => t.encoded.includes(substring));
	}

	public findAllByEncodedContains(substring: string): QueueTrack[] {
		return this._slice().filter((t) => t.encoded.includes(substring));
	}

	public indexByEncoded(encoded: string): number {
		return this._slice().findIndex((t) => t.encoded === encoded);
	}

	public findByTitle(
		query: string,
		options: { exact?: boolean; caseSensitive?: boolean } = {},
	): QueueTrack | undefined {
		const { exact = false, caseSensitive = false } = options;
		const normalizedQuery = caseSensitive ? query : query.toLowerCase();
		return this._slice().find((track) => {
			const title = caseSensitive ? track.info.title : track.info.title.toLowerCase();
			return exact ? title === normalizedQuery : title.includes(normalizedQuery);
		});
	}

	public findAllByTitle(
		query: string,
		options: { exact?: boolean; caseSensitive?: boolean } = {},
	): QueueTrack[] {
		const { exact = false, caseSensitive = false } = options;
		const normalizedQuery = caseSensitive ? query : query.toLowerCase();
		return this._slice().filter((t) => {
			const title = caseSensitive ? t.info.title : t.info.title.toLowerCase();
			return exact ? title === normalizedQuery : title.includes(normalizedQuery);
		});
	}

	public findByAuthor(
		author: string,
		options: { exact?: boolean; caseSensitive?: boolean } = {},
	): QueueTrack | undefined {
		const { exact = false, caseSensitive = false } = options;
		const normalizedAuthor = caseSensitive ? author : author.toLowerCase();
		return this._slice().find((t) => {
			const normalizedTrackAuthor = caseSensitive ? t.info.author : t.info.author.toLowerCase();
			return exact
				? normalizedTrackAuthor === normalizedAuthor
				: normalizedTrackAuthor.includes(normalizedAuthor);
		});
	}

	public findAllByAuthor(
		author: string,
		options: { exact?: boolean; caseSensitive?: boolean } = {},
	): QueueTrack[] {
		const { exact = false, caseSensitive = false } = options;
		const searchAuthor = caseSensitive ? author : author.toLowerCase();
		return this._slice().filter((t) => {
			const trackAuthor = caseSensitive ? t.info.author : t.info.author.toLowerCase();
			return exact ? trackAuthor === searchAuthor : trackAuthor.includes(searchAuthor);
		});
	}

	public findByRequester(userId: string): QueueTrack | undefined {
		return this._slice().find((t) => t.requester.id === userId);
	}

	public findAllByRequester(userId: string): QueueTrack[] {
		return this._slice().filter((t) => t.requester.id === userId);
	}

	public findByUri(uri: string): QueueTrack | undefined {
		return this._slice().find((t) => t.info.uri === uri);
	}

	public findAllByUri(uri: string): QueueTrack[] {
		return this._slice().filter((t) => t.info.uri === uri);
	}

	public filter(predicate: (track: QueueTrack, index: number) => boolean): QueueTrack[] {
		return this._slice().filter(predicate);
	}

	public findIndex(predicate: (track: QueueTrack, index: number) => boolean): number {
		return this._slice().findIndex(predicate);
	}

	public indexOf(track: QueueTrack): number {
		return this._slice().indexOf(track);
	}

	public some(predicate: (track: QueueTrack) => boolean): boolean {
		return this._slice().some(predicate);
	}

	public every(predicate: (track: QueueTrack) => boolean): boolean {
		return this._slice().every(predicate);
	}

	public totalDuration(): number {
		return this._slice().reduce((acc, t) => acc + (t.info.isStream ? 0 : t.info.length), 0);
	}

	public durationUntil(index: number): number {
		this._assertIndex(index);
		return this._slice()
			.slice(0, index)
			.reduce((acc, t) => acc + (t.info.isStream ? 0 : t.info.length), 0);
	}

	private _slice(): QueueTrack[] {
		return this._tracks.slice(this._head) as QueueTrack[];
	}

	private _assertIndex(index: number): void {
		if (index < 0 || index >= this.size) {
			throw new PlayerError(
				"INVALID_INDEX",
				`Queue index ${index} is out of range (size: ${this.size})`,
			);
		}
	}

	private _pushHistory(track: QueueTrack): void {
		this._history.push(track);
		while (this._history.length > this._historyLimit) {
			this._history.shift();
		}
	}

	private _rebalanceFairplay(): void {
		const upcoming = this._tracks.slice(this._head);
		if (upcoming.length <= 1) return;

		const buckets = new Map<string, QueueTrack[]>();
		const order: string[] = [];
		for (const track of upcoming) {
			const id = track.requester.id;
			let bucket = buckets.get(id);
			if (bucket === undefined) {
				bucket = [];
				buckets.set(id, bucket);
				order.push(id);
			}
			bucket.push(track);
		}

		const interleaved: QueueTrack[] = [];
		let inserted = true;
		while (inserted) {
			inserted = false;
			for (const id of order) {
				const bucket = buckets.get(id) as QueueTrack[];
				const next = bucket.shift();
				if (next !== undefined) {
					interleaved.push(next);
					inserted = true;
				}
			}
		}

		this._tracks = [...this._tracks.slice(0, this._head), ...interleaved];
	}

	private _maybeCompact(): void {
		if (this._head >= this._compactThreshold) {
			this._tracks = this._tracks.slice(this._head);
			this._head = 0;
		}
	}
}
