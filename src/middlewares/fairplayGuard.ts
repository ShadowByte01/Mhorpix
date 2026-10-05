import { PermissionFlagsBits } from "discord.js";
import { ensureGuild } from "../db/stores/guild.js";
import type { CommandContext } from "../structures/context/index.js";
import type { MiddlewareFn } from "../types/index.js";
import { fail, ok, withLabel } from "../types/index.js";

export const FAIRPLAY_MOD_PERMISSION = PermissionFlagsBits.MuteMembers;

export async function isFairplayMod(ctx: CommandContext): Promise<boolean> {
	if (ctx.member.permissions.has(FAIRPLAY_MOD_PERMISSION)) return true;

	const guild = await ensureGuild(ctx.guild.id);
	if (!guild.fairplayModRoleId) return false;

	return ctx.member.roles.cache.has(guild.fairplayModRoleId);
}

async function missingModMessage(ctx: CommandContext): Promise<string> {
	const guild = await ensureGuild(ctx.guild.id);
	return guild.fairplayModRoleId
		? "You need Mute Members, or the Fairplay Mod role, to do this."
		: "You need Mute Members to do this — no Fairplay Mod role is set yet. Ask an admin to run `/fairplayrole` (or the Fairplay tab in `/config`) to set one.";
}

export function fairplayBlocked(featureLabel: string): MiddlewareFn {
	return withLabel(`${featureLabel} Blocked During Fairplay`, (ctx) => {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player?.isFairplay()) return ok();

		return fail(
			"Fairplay Active",
			`${featureLabel} is disabled while Fairplay mode is on — it would break the fair rotation.`,
		);
	});
}

export function fairplayModRequired(): MiddlewareFn {
	return withLabel("Fairplay Mod Required", async (ctx) => {
		if (await isFairplayMod(ctx)) return ok();
		return fail("Missing Permissions", await missingModMessage(ctx));
	});
}

export function fairplayModOnly(): MiddlewareFn {
	return withLabel("Fairplay Mod Only (When Active)", async (ctx) => {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player?.isFairplay()) return ok();
		if (await isFairplayMod(ctx)) return ok();

		return fail("Fairplay Active", await missingModMessage(ctx));
	});
}

export function fairplayCurrentTrackOwnerOrMod(): MiddlewareFn {
	return withLabel("Track Owner or Fairplay Mod (When Active)", async (ctx) => {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player?.isFairplay()) return ok();
		if (await isFairplayMod(ctx)) return ok();

		const requesterId = player.currentTrack?.requester.id;
		if (requesterId !== undefined && requesterId === ctx.user.id) return ok();

		return fail(
			"Fairplay Active",
			"Only the requester of the current song, or a mod, can use this while Fairplay mode is on.",
		);
	});
}
