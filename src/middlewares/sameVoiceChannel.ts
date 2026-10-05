import type { MiddlewareFn } from "../types/index.js";
import { fail, ok, withLabel } from "../types/index.js";
import { isSameVoiceChannel } from "../utils/permissions.js";

export function sameVoiceChannel(): MiddlewareFn {
	return withLabel("Same Voice Channel", (ctx) => {
		if (!isSameVoiceChannel(ctx.member, ctx.guild)) {
			return fail(
				"Same Voice Channel Required",
				"You must be in the same voice channel as the bot to use this command.",
			);
		}
		return ok();
	});
}
