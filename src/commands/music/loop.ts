import { ApplicationCommandOptionType, ComponentType, MessageFlags } from "discord.js";
import { Middleware } from "../../middlewares/index.js";
import { defineCommand, LoopMode } from "../../types/index.js";
import {
	ActionRow,
	errorContainer,
	secondaryButton,
	successButton,
} from "../../utils/components.js";

const LOOP_MODES: { mode: LoopMode; label: string }[] = [
	{ mode: LoopMode.None, label: "None" },
	{ mode: LoopMode.Track, label: "Track" },
	{ mode: LoopMode.Queue, label: "Queue" },
];

function getCustomId(mode: LoopMode): string {
	return `loop_${String(mode).toLowerCase()}`;
}

function buildLoopRow(active: LoopMode, allDisabled = false) {
	const row = ActionRow();
	for (const mode of LOOP_MODES) {
		const isActive = mode.mode === active;
		const btn = isActive
			? successButton(mode.label, getCustomId(mode.mode)).setDisabled(true)
			: secondaryButton(mode.label, getCustomId(mode.mode)).setDisabled(allDisabled);
		row.addComponents(btn);
	}
	return row;
}

export default defineCommand({
	name: "loop",
	aliases: ["loopmode", "repeat"],
	description: "Change the loop mode",
	category: "music",
	usage: "loop [none|track|queue]",
	slashUsage: "loop [none|track|queue]",
	enabledSlash: true,
	slashData: {
		name: "loop",
		description: "Change the loop mode",
		options: [
			{
				name: "mode",
				description: "The loop mode to set",
				type: ApplicationCommandOptionType.String,
				required: true,
				choices: [
					{
						name: "None",
						value: LoopMode.None,
					},
					{
						name: "Track",
						value: LoopMode.Track,
					},
					{
						name: "Queue",
						value: LoopMode.Queue,
					},
				],
			},
		],
	},
	middleware: [
		Middleware.Cooldown(15),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.PlayerCheck("playing"),
		Middleware.FairplayBlocked("Loop"),
	],
	async execute(ctx) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player) return;

		const mode = (ctx.isSlash() ? ctx.options.getString("mode", false) : ctx.args[0]) as LoopMode;
		const validModes = [LoopMode.None, LoopMode.Track, LoopMode.Queue];
		if (mode && validModes.includes(mode)) {
			player.setLoop(mode);
		}
		const currentLoop = player.getLoop();

		const message = await ctx.reply({
			components: [buildLoopRow(currentLoop)],
			flags: MessageFlags.IsComponentsV2,
		});

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 60_000,
		});

		collector.on("collect", async (interaction) => {
			if (interaction.user.id !== ctx.member.id) {
				await interaction.reply({
					components: [errorContainer("Not Authorized", "You are not authorized to do this.")],
					flags: MessageFlags.IsComponentsV2,
				});
				return;
			}

			const selected = LOOP_MODES.find((m) => getCustomId(m.mode) === interaction.customId);
			if (!selected) return;

			if (
				player.timestamps.lastLoopChangedAt &&
				player.timestamps.lastLoopChangedAt > message.createdTimestamp
			) {
				const newLoop = player.getLoop();

				await interaction.update({
					components: [buildLoopRow(newLoop)],
				});

				await interaction.followUp({
					components: [
						errorContainer(
							"Loop Changed",
							"The loop mode has been changed since this message was sent. Please click again.",
						),
					],
					flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				});
				return;
			}

			player.setLoop(selected.mode);

			await interaction.update({
				components: [buildLoopRow(selected.mode)],
			});
		});

		collector.on("end", async () => {
			try {
				await message.edit({
					components: [buildLoopRow(player.getLoop(), true)],
				});
			} catch {
				// Message was deleted
			}
		});
	},
});
