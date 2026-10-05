import type { MiddlewareFn } from "../types/index.js";
import { ok, withLabel } from "../types/index.js";

export function voteRequired(): MiddlewareFn {
	return withLabel("Vote Required", async (_ctx) => {
		return ok();
	});
}
