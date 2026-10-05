export type { ManagerErrorCode, PlayerErrorCode } from "./errors.js";
export { ManagerError, PlayerError } from "./errors.js";
export type { ManagerEvents, MusicEvent } from "./events.js";
export { defineMusicEvent } from "./events.js";
export type { ManagerOptions } from "./Manager.js";
export { Manager as MusicManager } from "./Manager.js";
export type { PlayerDataStore } from "./Player.js";
export { Player as MusicPlayer } from "./Player.js";
export type { PlayerSnapshotData } from "./persistence.js";
export {
	clearPlayerSnapshot,
	loadAllSnapshotGuildIds,
	loadPlayerSnapshot,
	savePlayerSnapshot,
} from "./persistence.js";
export type { QueueOptions } from "./Queue.js";
export { Queue as MusicQueue } from "./Queue.js";
export { installSessionResumePatch, persistSessionId, warmSessionCache } from "./session.js";
export type {
	CreatePlayerOptions,
	FavouriteTrack,
	LavaSearchEntry,
	LavaSearchResult,
	LavaSearchResultType,
	LavaSearchTrack,
	PartialQueueTrack,
	PlayerSnapshot,
	PlayerTimestamps,
	QueueTrack,
	SearchResultNormalized,
	TrackRequester,
} from "./types.js";
export { LavaSearchSource, LoopMode, SearchSource } from "./types.js";
export { buildSearchIdentifier, calcShardId, isUrl } from "./utils.js";
