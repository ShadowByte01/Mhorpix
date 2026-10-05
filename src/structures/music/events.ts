import type { Exception, PlayerUpdate, TrackEndReason, WebSocketClosedEvent } from "shoukaku";
import type { BotClient } from "../../core/BotClient.js";
import type { Player } from "./Player.js";
import type { PlayerSnapshot, QueueTrack } from "./types.js";

export type ManagerEvents = {
	trackStart: [player: Player, track: QueueTrack, snapshot: PlayerSnapshot];
	trackEnd: [player: Player, track: QueueTrack, reason: TrackEndReason, snapshot: PlayerSnapshot];
	trackStuck: [player: Player, track: QueueTrack, snapshot: PlayerSnapshot];
	trackError: [player: Player, track: QueueTrack, exception: Exception, snapshot: PlayerSnapshot];
	queueFinish: [player: Player, snapshot: PlayerSnapshot];
	playerCreate: [player: Player];
	playerDestroy: [player: Player, snapshot: PlayerSnapshot];
	playerClosed: [player: Player, data: WebSocketClosedEvent, snapshot: PlayerSnapshot];
	playerResumed: [player: Player];
	playerUpdate: [player: Player, data: PlayerUpdate];
	nodeReady: [nodeName: string, lavalinkResume: boolean, libraryResume: boolean];
	nodeError: [nodeName: string, error: Error];
	nodeDisconnect: [nodeName: string, movedPlayers: number];
	nodeReconnect: [nodeName: string, triesLeft: number, interval: number];
	error: [player: Player | null, error: Error];
};

export interface MusicEvent<K extends keyof ManagerEvents = keyof ManagerEvents> {
	name: K;
	once?: boolean;
	execute: (client: BotClient, ...args: ManagerEvents[K]) => Promise<void> | void;
}

export const defineMusicEvent = <K extends keyof ManagerEvents>(
	event: MusicEvent<K>,
): MusicEvent<K> => event;
