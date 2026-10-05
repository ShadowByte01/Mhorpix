/**
 * Credits: Xentara — Made by Xentara, managed by Xentara HQ
 * Author:  @losttweeds.exe
 *
 */

import type { ButtonInteraction } from "discord.js";
import { ComponentType, MessageFlags, PermissionFlagsBits } from "discord.js";
import { ensureGuild, setFairplayDefault } from "../../../db/stores/guild.js";
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

const ENABLE_BUTTON_ID = "fairplaydefault:enable";
const DISABLE_BUTTON_ID = "fairplaydefault:disable";
const COLLECTOR_TIME = 60_000;

function buildStatusText(enabled: boolean): string {
	return enabled
		? "-# Fairplay defaults to **on** for every new queue in this server."
		: "-# Fairplay defaults to **off** for new queues. Use `/fairplay` to turn it on per-session.";
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
	name: "fairplaydefault",
	aliases: ["fpdefault", "fpdef"],
	description: "Set whether Fairplay mode is on by default for new queues in this server",
	category: "meta",
	enabledSlash: true,
	slashData: {
		name: ["config", "fairplay"],
		description: "Set whether Fairplay mode is on by default for new queues in this server",
	},
	middleware: [
		Middleware.UserPermissions(PermissionFlagsBits.ManageGuild),
		Middleware.Cooldown(15),
	],
	async execute(ctx) {
		const guild = await ensureGuild(ctx.guild.id);
		let enabled = guild.fairplayDefault;

		const message = await ctx.reply({
			components: buildComponents(enabled),
			flags: MessageFlags.IsComponentsV2,
		});

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			filter: (i) => i.customId === ENABLE_BUTTON_ID || i.customId === DISABLE_BUTTON_ID,
			time: COLLECTOR_TIME,
		});

		const applyDefault = async (button: ButtonInteraction, target: boolean): Promise<void> => {
			const updated = await setFairplayDefault(ctx.guild.id, target);

			enabled = updated.fairplayDefault;
			if (enabled !== target) {
				logger.warn(
					"Config",
					`Fairplay default for guild ${ctx.guild.id} requested=${target} but store returned ${enabled} — check the guilds cache/BaseStore.`,
				);
			}

			const player = ctx.client.music.getPlayer(ctx.guild.id);
			if (player) player.setFairplay(enabled);

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

			await applyDefault(button, button.customId === ENABLE_BUTTON_ID);
		});

		collector.on("end", async () => {
			await message.edit({ components: buildComponents(enabled, true) }).catch(() => undefined);
		});
	},
});
