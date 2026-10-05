import type { MiddlewareFn } from "../types/index.js";
import { fail, ok, withLabel } from "../types/index.js";
import { getMissingBotPermissions, permissionName } from "../utils/permissions.js";

export function botPermissions(...permissions: bigint[]): MiddlewareFn {
	const label = `Bot Needs: ${permissions.map(permissionName).join(", ")}`;

	return withLabel(label, (ctx) => {
		const missing = getMissingBotPermissions(ctx.channel, permissions);

		if (missing.length) {
			return fail(
				"Missing Bot Permissions",
				`I need the following permission(s): \`${missing.join(", ")}\``,
			);
		}

		return ok();
	});
}
