import { config } from "../config/config.js";
import type { MiddlewareFn } from "../types/index.js";
import { fail, ok, withLabel } from "../types/index.js";

export function ownerOnly(): MiddlewareFn {
	return withLabel("Owner Only", (ctx) => {
		if (!config.ownerIds.includes(ctx.user.id)) {
			return fail("Permission Denied", "This is an owner-only command.", { silent: true });
		}
		return ok();
	});
}
