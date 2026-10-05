import type { Exception, Track } from "shoukaku";

export const SearchSource = {
	YouTube: "ytsearch",
	YouTubeMusic: "ytmsearch",
	SoundCloud: "scsearch",
	Spotify: "spsearch",
	AppleMusic: "amsearch",
	Deezer: "dzsearch",
	JioSaavn: "jssearch",
	AudioMack: "amksearch",
	YandexMusic: "ymsearch",
	Direct: "",
} as const;

export type SearchSource = (typeof SearchSource)[keyof typeof SearchSource];

export interface TrackRequester {
	readonly id: string;
	readonly username: string;
	readonly displayName: string;
}

export interface QueueTrack {
	readonly encoded: string;
	readonly info: Track["info"];
	/** Lavalink plugin-specific metadata. Shape varies per plugin — treat as opaque. */
	readonly pluginInfo: Record<string, unknown>;
	readonly requester: TrackRequester;
	readonly addedAt: number;
}

export type PartialQueueTrack = Omit<QueueTrack, "requester" | "addedAt">;

export const LoopMode = {
	None: "none",
	Track: "track",
	Queue: "queue",
} as const;

export type LoopMode = (typeof LoopMode)[keyof typeof LoopMode];

export interface PlayerTimestamps {
	readonly createdAt: number;
	lastTrackStartedAt: number | null;
	lastQueueUpdatedAt: number | null;
	lastSeekedAt: number | null;
	lastVolumeChangedAt: number | null;
	lastPlayStateChangedAt: number | null;
	lastLoopChangedAt: number | null;
	lastFairplayChangedAt: number | null;
}

export interface PlayerSnapshot {
	readonly guildId: string;
	readonly textChannelId: string | null;
	readonly voiceChannelId: string | null;
	readonly currentTrack: QueueTrack | null;
	readonly position: number;
	readonly volume: number;
	readonly paused: boolean;
}

type SearchBase = {
	readonly source: SearchSource;
	readonly query: string;
	readonly identifier: string;
};

export type SearchResultNormalized = SearchBase &
	(
		| { readonly type: "track"; readonly tracks: [PartialQueueTrack]; readonly playlistName: null }
		| {
				readonly type: "playlist";
				readonly tracks: PartialQueueTrack[];
				readonly playlistName: string;
				readonly selectedTrack: number;
		  }
		| { readonly type: "search"; readonly tracks: PartialQueueTrack[]; readonly playlistName: null }
		| { readonly type: "empty"; readonly tracks: []; readonly playlistName: null }
		| {
				readonly type: "error";
				readonly tracks: [];
				readonly playlistName: null;
				readonly exception: Exception;
		  }
	);

/**
 * LavaSearch (`/v4/loadsearch`) is a LavaSrc plugin extension, not part of
 * core Lavalink v4 — Shoukaku has no typed client for it, so these shapes
 * are hand-defined to match the plugin's documented response schema.
 */
export const LavaSearchSource = {
	Deezer: "dzsearch",
	AppleMusic: "amsearch",
} as const;

export type LavaSearchSource = (typeof LavaSearchSource)[keyof typeof LavaSearchSource];

export type LavaSearchResultType = "track" | "album" | "artist" | "playlist";

export interface LavaSearchTrack {
	readonly encoded: string;
	readonly info: Track["info"];
	readonly pluginInfo: Record<string, unknown>;
}

export interface LavaSearchEntry {
	readonly name: string;
	readonly url: string | null;
	readonly author: string | null;
	readonly totalTracks: number | null;
	readonly artworkUrl: string | null;
}

export interface LavaSearchResult {
	readonly source: LavaSearchSource;
	readonly query: string;
	readonly tracks: readonly LavaSearchTrack[];
	readonly albums: readonly LavaSearchEntry[];
	readonly artists: readonly LavaSearchEntry[];
	readonly playlists: readonly LavaSearchEntry[];
}

export interface CreatePlayerOptions {
	readonly guildId: string;
	readonly voiceChannelId: string;
	readonly textChannelId?: string | null;
	readonly deaf?: boolean;
	readonly mute?: boolean;
	readonly volume?: number;
}

export interface FavouriteTrack {
	readonly encoded: string;
	readonly addedAt: number;
}
