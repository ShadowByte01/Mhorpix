import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import { defineCommand } from "../../types/command.js";
import { defContainer, errorContainer, TextDisplay } from "../../utils/components.js";

const MIN_VOLUME = 0;
const MAX_VOLUME = 150;

async function replyVolumeError(
	ctx: CommandContext,
	title: string,
	description: string,
): Promise<void> {
	await ctx.reply({
		components: [errorContainer(title, description)],
		flags: MessageFlags.IsComponentsV2,
	});
}

function parseVolumeArg(ctx: CommandContext): number | undefined {
	const raw = ctx.isSlash()
		? ctx.options.getInteger("level", false)
		: Number.parseInt(ctx.args[0] ?? "", 10);
	return raw === null || raw === undefined || Number.isNaN(raw) ? undefined : raw;
}

export default defineCommand({
	name: "volume",
	aliases: ["vol"],
	description: "View or set the player volume",
	category: "music",
	usage: "volume [level]",
	slashUsage: "volume [level]",
	enabledSlash: true,
	middleware: [
		Middleware.Cooldown(10),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.PlayerCheck("playing"),
		Middleware.FairplayModOnly(),
		Middleware.VoteRequired(),
	],
	slashData: {
		name: "volume",
		description: "View or set the player volume",
		options: [
			{
				type: ApplicationCommandOptionType.Integer,
				name: "level",
				description: `Volume level (${MIN_VOLUME}-${MAX_VOLUME})`,
				min_value: MIN_VOLUME,
				max_value: MAX_VOLUME,
				required: false,
				autocomplete: false,
			},
		],
	},
	async execute(ctx) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player) return;

		const level = parseVolumeArg(ctx);

		if (level === undefined) {
			await ctx.reply({
				components: [
					defContainer().addTextDisplayComponents(
						TextDisplay(`-# Current volume is \`${player.volume}%\`.`),
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		if (!Number.isInteger(level) || level < MIN_VOLUME || level > MAX_VOLUME) {
			await replyVolumeError(
				ctx,
				"Invalid Volume",
				`Volume must be a whole number between ${MIN_VOLUME} and ${MAX_VOLUME}.`,
			);
			return;
		}

		await player.setVolume(level);

		await ctx.reply({
			components: [
				defContainer().addTextDisplayComponents(TextDisplay(`-# Volume set to \`${level}%\`.`)),
			],
			flags: MessageFlags.IsComponentsV2,
		});
	},
});
