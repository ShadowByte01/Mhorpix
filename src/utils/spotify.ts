const SPOTIFY_API = "https://sp-pl-bread.vercel.app/api/3";

export class SpotifyNotFoundError extends Error {
	constructor(spotifyId: string) {
		super(`Spotify profile not found: ${spotifyId}`);
		this.name = "SpotifyNotFoundError";
	}
}

export interface SpotifyPlaylistSummary {
	readonly name: string;
	readonly url: string;
	readonly artwork: string | null;
}

export interface SpotifyProfile {
	readonly id: string;
	readonly displayName: string;
	readonly url: string;
	readonly image: string | null;
	readonly playlists: readonly SpotifyPlaylistSummary[];
}

interface RawSpotifyPlaylist {
	name: string;
	url: string;
	artwork?: string | null;
}

interface RawSpotifyUser {
	id: string;
	display_name: string | null;
	external_urls: { spotify: string };
	images?: { url: string }[];
	playlists: {
		total: number;
		items: RawSpotifyPlaylist[];
	};
}

const BAD_ARTWORK_VALUES = new Set(["unknown", "uri", "null", "undefined", ""]);

function resolveArtwork(url: string | null | undefined): string | null {
	if (!url || BAD_ARTWORK_VALUES.has(url.toLowerCase().trim())) return null;
	return url;
}

export async function fetchSpotifyUser(spotifyId: string): Promise<SpotifyProfile> {
	const res = await fetch(`${SPOTIFY_API}?endpoint=user&id=${encodeURIComponent(spotifyId)}`);
	if (res.status === 404) throw new SpotifyNotFoundError(spotifyId);
	if (!res.ok) throw new Error(`Spotify API error: ${res.status}`);

	const data = (await res.json()) as RawSpotifyUser;

	return {
		id: data.id,
		displayName: data.display_name ?? data.id,
		url: data.external_urls.spotify,
		image: resolveArtwork(data.images?.[0]?.url),
		playlists: (data.playlists?.items ?? []).map((pl) => ({
			name: pl.name,
			url: pl.url,
			artwork: resolveArtwork(pl.artwork),
		})),
	};
}

const PROFILE_URL_RE = /open\.spotify\.com\/user\/([^?/\s]+)/;

export function extractSpotifyId(input: string): string | null {
	if (!input) return null;
	const trimmed = input.trim();

	const match = trimmed.match(PROFILE_URL_RE);
	if (match?.[1]) return match[1];

	if (/^[a-zA-Z0-9._-]+$/.test(trimmed)) return trimmed;

	return null;
}
