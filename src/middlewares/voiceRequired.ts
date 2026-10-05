import type { MiddlewareFn } from "../types/index.js";
import { fail, ok, withLabel } from "../types/index.js";
import { getVoiceChannelMissingPermissions } from "../utils/permissions.js";

export function voiceRequired(): MiddlewareFn {
	return withLabel("Voice Channel Required", (ctx) => {
		const voiceChannel = ctx.member.voice.channel;

		if (!voiceChannel) {
			return fail("Voice Channel Required", "You must be in a voice channel to use this command.");
		}

		const missing = getVoiceChannelMissingPermissions(voiceChannel);
		if (missing.length) {
			return fail(
				"Voice Channel Permissions",
				`I need the following permission(s) in your voice channel: \`${missing.join(", ")}\``,
			);
		}

		return ok();
	});
}
