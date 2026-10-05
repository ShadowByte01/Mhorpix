import { SearchSource } from "./types.js";

export const calcShardId = (guildId: string, totalShards: number): number => {
	if (totalShards <= 1) return 0;
	return Number((BigInt(guildId) >> 22n) % BigInt(totalShards));
};

export const isUrl = (s: string): boolean => {
	try {
		const url = new URL(s);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
};

export const buildSearchIdentifier = (query: string, source: SearchSource): string => {
	if (isUrl(query)) return query;
	if (source === SearchSource.Direct) return query;
	return `${source}:${query}`;
};
