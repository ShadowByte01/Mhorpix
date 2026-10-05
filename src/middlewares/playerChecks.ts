import type { MiddlewareFn } from "../types/index.js";
import { fail, ok, withLabel } from "../types/index.js";

const TYPE_LABELS: Readonly<Record<"exists" | "playing", string>> = {
	exists: "Active Player",
	playing: "Playing Track",
};

export function playerChecks(type: "exists" | "playing"): MiddlewareFn {
	return withLabel(TYPE_LABELS[type], (ctx) => {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player)
			return fail(
				"No player found",
				"No player found for this server And this command requires one.",
			);
		if (type === "exists") return ok();
		const isPlaying = player.hasCurrentTrack;
		if (type === "playing")
			return isPlaying ? ok() : fail("No song playing", "No song is currently playing.");
		return ok();
	});
}
