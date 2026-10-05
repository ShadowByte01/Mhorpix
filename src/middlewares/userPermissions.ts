import type { MiddlewareFn } from "../types/index.js";
import { fail, ok, withLabel } from "../types/index.js";
import { permissionName } from "../utils/permissions.js";

export function userPermissions(...permissions: bigint[]): MiddlewareFn {
	const label = `Requires: ${permissions.map(permissionName).join(", ")}`;

	return withLabel(label, (ctx) => {
		const missing = permissions.filter((permission) => !ctx.member.permissions.has(permission));

		if (missing.length) {
			return fail(
				"Insufficient Permissions",
				`You need the following permission(s): \`${missing.map(permissionName).join(", ")}\``,
			);
		}

		return ok();
	});
}
