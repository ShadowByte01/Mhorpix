import type { ButtonInteraction } from "discord.js";
import { ComponentType, MessageFlags, PermissionFlagsBits } from "discord.js";
import {
	disableTwentyFourSeven,
	ensureGuild,
	setTwentyFourSeven,
} from "../../../db/stores/guild.js";
import { Middleware } from "../../../middlewares/index.js";
import { defineCommand } from "../../../types/index.js";
import {
	ActionRow,
	dangerButton,
	defContainer,
	errorContainer,
	successButton,
	TextDisplay,
} from "../../../utils/components.js";
import { logger } from "../../../utils/logger.js";

const ENABLE_BUTTON_ID = "247:enable";
const DISABLE_BUTTON_ID = "247:disable";
const COLLECTOR_TIME = 60_000;

function buildStatusText(enabled: boolean): string {
	return enabled
		? "-# 24/7 mode is **enabled**. I'll stay in voice when the queue ends."
		: "-# 24/7 mode is **disabled**. I'll leave voice when the queue ends.";
}

function buildButtonsRow(enabled: boolean, lockAll = false) {
	return ActionRow().addComponents(
		successButton("Enable", ENABLE_BUTTON_ID, lockAll || enabled),
		dangerButton("Disable", DISABLE_BUTTON_ID, lockAll || !enabled),
	);
}

function buildComponents(enabled: boolean, lockAll = false) {
	return [
		defContainer()
			.addTextDisplayComponents(TextDisplay(buildStatusText(enabled)))
			.addActionRowComponents(buildButtonsRow(enabled, lockAll)),
	];
}

async function replyError(
	button: ButtonInteraction,
	title: string,
	description: string,
): Promise<void> {
	await button.reply({
		components: [errorContainer(title, description)],
		flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
	});
}

export default defineCommand({
	name: "247",
	aliases: ["24/7", "alwayson"],
	description: "Enable or disable 24/7 mode for this server",
	category: "meta",
	enabledSlash: true,
	slashData: {
		name: ["config", "247"],
		description: "Enable or disable 24/7 mode for this server",
	},
	middleware: [
		Middleware.Cooldown(30),
		Middleware.UserPermissions(PermissionFlagsBits.ManageGuild),
		Middleware.Premium("server"),
	],
	async execute(ctx) {
		const guild = await ensureGuild(ctx.guild.id);
		let enabled = guild.twentyFourSeven;

		const message = await ctx.reply({
			components: buildComponents(enabled),
			flags: MessageFlags.IsComponentsV2,
		});

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			filter: (i) => i.customId === ENABLE_BUTTON_ID || i.customId === DISABLE_BUTTON_ID,
			time: COLLECTOR_TIME,
		});

		const handleEnable = async (button: ButtonInteraction): Promise<void> => {
			const player = ctx.client.music.getPlayer(ctx.guild.id);
			if (!player) {
				await replyError(
					button,
					"No Player",
					"I need to be actively playing in a voice channel to enable 24/7 mode.",
				);
				return;
			}

			const updated = await setTwentyFourSeven(ctx.guild.id, true, {
				textChannelId: player.currentTextChannelId ?? button.channelId ?? "",
				voiceChannelId: player.voiceChannelId,
			});

			enabled = updated.twentyFourSeven;
			if (!enabled) {
				logger.warn(
					"Config",
					`24/7 enable requested for guild ${ctx.guild.id} but the store returned false — check the guilds cache/BaseStore.`,
				);
			}

			await button.update({ components: buildComponents(enabled) });
		};

		const handleDisable = async (button: ButtonInteraction): Promise<void> => {
			const updated = await disableTwentyFourSeven(ctx.guild.id);
			enabled = updated.twentyFourSeven;
			await button.update({ components: buildComponents(enabled) });
		};

		collector.on("collect", async (button) => {
			if (button.user.id !== ctx.user.id) {
				await replyError(button, "Not Authorized", "You are not authorized to do this.");
				return;
			}

			if (!button.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
				await replyError(
					button,
					"Missing Permissions",
					"You no longer have permission to manage this server.",
				);
				return;
			}

			if (button.customId === ENABLE_BUTTON_ID) {
				await handleEnable(button);
				return;
			}

			await handleDisable(button);
		});

		collector.on("end", async () => {
			await message.edit({ components: buildComponents(enabled, true) }).catch(() => undefined);
		});
	},
});
