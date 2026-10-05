export type PlayerErrorCode =
	| "DESTROYED"
	| "NO_TRACK_PLAYING"
	| "QUEUE_EMPTY"
	| "QUEUE_FULL"
	| "INVALID_INDEX"
	| "INVALID_SEEK"
	| "ADVANCING"
	| "PLAY_FAILED";

export class PlayerError extends Error {
	public readonly code: PlayerErrorCode;

	public constructor(code: PlayerErrorCode, message: string) {
		super(message);
		this.name = "PlayerError";
		this.code = code;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

export type ManagerErrorCode =
	| "PLAYER_EXISTS"
	| "PLAYER_NOT_FOUND"
	| "NO_NODES"
	| "SEARCH_FAILED"
	| "INVALID_SHARD"
	| "JOIN_FAILED";

export class ManagerError extends Error {
	public readonly code: ManagerErrorCode;

	public constructor(code: ManagerErrorCode, message: string) {
		super(message);
		this.name = "ManagerError";
		this.code = code;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}
