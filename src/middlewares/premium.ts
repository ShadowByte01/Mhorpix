import type { MiddlewareFn } from "../types/index.js";
import { ok, withLabel } from "../types/index.js";

const SCOPE_LABELS: Readonly<Record<"user" | "server" | "any", string>> = {
	user: "User Premium",
	server: "Server Premium",
	any: "Premium",
};

export function premiumRequired(scope: "user" | "server" | "any"): MiddlewareFn {
	return withLabel(SCOPE_LABELS[scope], async (_ctx) => {
		return ok();
	});
}
