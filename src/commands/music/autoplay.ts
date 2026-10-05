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
	name: "autoplay",
	aliases: ["ap"],
	description: "Toggle autoplay: automatically queues similar tracks when the queue runs low.",
	usage: "autoplay [on|off]",
	slashUsage: "autoplay [on|off]",
	category: "music",
	enabledSlash: true,
	slashData: {
		name: "autoplay",
		description: "Toggle autoplay for this queue",
		options: [
			{
				type: ApplicationCommandOptionType.String,
				name: "state",
				description: "Turn autoplay on or off",
				required: true,
				choices: [
					{ name: "On", value: "on" },
					{ name: "Off", value: "off" },
				],
			},
		],
	},
	middleware: [
		Middleware.Cooldown(30),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.PlayerCheck("playing"),
		Middleware.VoteRequired(),
	],
	async execute(ctx) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player) return;

		const state = parseState(ctx);
		if (state === undefined) {
			await ctx.reply({
				components: [
					errorContainer("Invalid Option", "Use `on` or `off`, e.g. `/autoplay state:on`."),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const enable = state === "on";
		if (enable === player.getAutoplay()) {
			await ctx.reply({
				components: [errorContainer("No Change", `Autoplay is already ${enable ? "on" : "off"}.`)],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		player.setAutoplay(enable);

		const onSummary = [
			"-# **Autoplay is now ON**",
			"-# Similar tracks will be auto-queued when the queue runs low.",
		].join("\n");

		await ctx.reply({
			components: [
				defContainer().addTextDisplayComponents(
					TextDisplay(enable ? onSummary : "-# Autoplay is now **OFF**."),
				),
			],
			flags: MessageFlags.IsComponentsV2,
		});
	},
});
