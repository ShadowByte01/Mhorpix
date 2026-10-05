import { hasVotedRecently } from "../db/stores/votes.js";
import { premiumService } from "../services/premium.js";
import type { CommandContext } from "../structures/context/index.js";
import type { MiddlewareFn } from "../types/index.js";
import { fail, ok, withLabel } from "../types/index.js";

/**
const YOUTUBE_HOSTS = new Set([
	"youtube.com",
	"www.youtube.com",
	"m.youtube.com",
	"music.youtube.com",
	"youtu.be",
]);
*/

function extractQuery(ctx: CommandContext): string {
	if (ctx.isSlash()) return ctx.options.getString("query", true) ?? "";
	return ctx.args.join(" ");
}

function parseUrl(raw: string): URL | null {
	try {
		return new URL(raw);
	} catch {
		return null;
	}
}
/**
function isYoutubeHost(hostname: string): boolean {
	return YOUTUBE_HOSTS.has(hostname.toLowerCase());
}
function isYoutubePlaylistLink(url: URL): boolean {
	return (
		isYoutubeHost(url.hostname) && url.pathname === "/playlist" && url.searchParams.has("list")
	);
}
*/

export function linkGateRequired(): MiddlewareFn {
	return withLabel("Link Gate", async (ctx) => {
		const query = extractQuery(ctx).trim();
		if (!/^https?:\/\//i.test(query)) return ok();

		const url = parseUrl(query);
		if (!url) return ok();
		/**
		if (isYoutubeHost(url.hostname) && !isYoutubePlaylistLink(url)) {
			return fail(
				"YouTube Links Blocked",
				"Direct YouTube / YouTube Music links aren't supported — only YouTube playlist links are allowed. Try `/search` to find and queue individual tracks instead.",
			);
		}
*/
		const [voted, hasPremium] = await Promise.all([
			hasVotedRecently(ctx.member.id),
			premiumService.hasAnyPremium(ctx.guild.id, ctx.member.id),
		]);

		if (voted || hasPremium) return ok();

		return fail(
			"Vote or Premium Required",
			"Playing a link requires an active vote or premium. Vote on Top.gg or check `/premium` for plans.",
		);
	});
}
