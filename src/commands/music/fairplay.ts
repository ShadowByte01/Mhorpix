/**
 * Credits: Xentara — Made by Xentara, managed by Xentara HQ
 * Author:  @losttweeds.exe
 *
 */

import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import { defineCommand } from "../../types/index.js";
import { defContainer, errorContainer, TextDisplay } from "../../utils/components.js";

function parseState(ctx: CommandContext): "on" | "off" | undefined {
	const raw = (ctx.isSlash() ? ctx.options.getString("state", true) : ctx.args[0]) ?? "";
	const normalized = raw.trim().toLowerCase();
	if (["on", "enable", "enabled", "true"].includes(normalized)) return "on";
	if (["off", "disable", "disabled", "false"].includes(normalized)) return "off";
	return undefined;
}

export default defineCommand({
	name: "fairplay",
	aliases: ["fp"],
	description:
		"Toggle Fairplay mode: rotates the queue evenly between requesters and locks skip/seek/remove/pause/resume/clear/shuffle/previous to the track owner or a mod",
	usage: "fairplay [on|off]",
	slashUsage: "fairplay [on|off]",
	category: "music",
	enabledSlash: true,
	slashData: {
		name: "fairplay",
		description: "Toggle Fairplay mode for this queue",
		options: [
			{
				type: ApplicationCommandOptionType.String,
				name: "state",
				description: "Turn Fairplay on or off",
				required: true,
				choices: [
					{ name: "On", value: "on" },
					{ name: "Off", value: "off" },
				],
			},
		],
	},
	middleware: [
		Middleware.Cooldown(15),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.PlayerCheck("playing"),
		Middleware.FairplayModRequired(),
		Middleware.VoteRequired(),
	],
	async execute(ctx) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player) return;

		const state = parseState(ctx);
		if (state === undefined) {
			await ctx.reply({
				components: [
					errorContainer("Invalid Option", "Use `on` or `off`, e.g. `/fairplay state:on`."),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const enable = state === "on";
		if (enable === player.isFairplay()) {
			await ctx.reply({
				components: [
					errorContainer("No Change", `Fairplay mode is already ${enable ? "on" : "off"}.`),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		player.setFairplay(enable);

		const onSummary = [
			"-# **Fairplay mode is now ON**",
			"-# The queue auto-rotates so every requester gets a fair turn.",
			"-# `skip` / `seek` / `remove` — only the track's requester or a mod.",
			"-# `pause` / `resume` / `clearqueue` / `stop` — mods only.",
			"-# `shuffle` / `previous` / `loop` — disabled entirely.",
		].join("\n");

		await ctx.reply({
			components: [
				defContainer().addTextDisplayComponents(
					TextDisplay(
						enable ? onSummary : "-# Fairplay mode is now **OFF** — normal queue rules apply.",
					),
				),
			],
			flags: MessageFlags.IsComponentsV2,
		});
	},
});
