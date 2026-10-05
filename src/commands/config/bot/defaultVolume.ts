/**
 * Credits: Xentara — Made by Xentara, managed by Xentara HQ
 * Author:  @losttweeds.exe
 *
 */

import {
	ComponentType,
	MessageFlags,
	type ModalSubmitInteraction,
	PermissionFlagsBits,
	TextInputStyle,
} from "discord.js";
import {
	DEFAULT_VOLUME_MAX,
	DEFAULT_VOLUME_MIN,
	ensureGuild,
	setDefaultVolume,
} from "../../../db/stores/guild.js";
import { Middleware } from "../../../middlewares/index.js";
import { defineCommand } from "../../../types/index.js";
import { ActionRow, Label, Modal, secondaryButton, TextInput } from "../../../utils/components.js";

const EDIT_BUTTON_ID = "defaultvolume:edit";
const MODAL_ID = "defaultvolume:modal";
const INPUT_ID = "defaultvolume:input";
const COLLECTOR_TIME = 60_000;

export default defineCommand({
	name: "defaultvolume",
	aliases: ["defvol", "dvol"],
	description: "View or change the default volume new queues start at in this server",
	category: "meta",
	enabledSlash: true,
	slashData: {
		name: ["config", "volume"],
		description: "View or change the default volume new queues start at in this server",
	},
	middleware: [
		Middleware.Cooldown(30),
		Middleware.UserPermissions(PermissionFlagsBits.ManageGuild),
		Middleware.Premium("server"),
	],
	async execute(ctx) {
		const guild = await ensureGuild(ctx.guild.id);

		const message = await ctx.reply({
			components: [
				ActionRow().addComponents(
					secondaryButton(`Default Volume: ${guild.defaultVolume}`, EDIT_BUTTON_ID),
				),
			],
			flags: MessageFlags.IsComponentsV2,
		});

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			filter: (i) => i.customId === EDIT_BUTTON_ID,
			time: COLLECTOR_TIME,
		});

		collector.on("collect", async (button) => {
			if (button.user.id !== ctx.user.id) {
				await button.reply({
					content: "You are not authorized to do this.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			if (!button.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
				await button.reply({
					content: "You no longer have permission to manage this server.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const current = await ensureGuild(ctx.guild.id);

			await button.showModal(
				Modal(MODAL_ID, "Edit Default Volume").addLabelComponents(
					Label(
						`Volume (${DEFAULT_VOLUME_MIN}-${DEFAULT_VOLUME_MAX})`,
						TextInput(INPUT_ID, TextInputStyle.Short, true)
							.setMaxLength(4)
							.setValue(String(current.defaultVolume))
							.setPlaceholder("e.g. 100"),
						`A whole number between ${DEFAULT_VOLUME_MIN} and ${DEFAULT_VOLUME_MAX}`,
					),
				),
			);

			let submitted: ModalSubmitInteraction | undefined;
			try {
				submitted = await button.awaitModalSubmit({
					filter: (m) => m.customId === MODAL_ID && m.user.id === ctx.user.id,
					time: COLLECTOR_TIME,
				});
			} catch {
				return;
			}

			const raw = submitted.fields.getTextInputValue(INPUT_ID).trim();
			const parsed = Number.parseInt(raw, 10);

			if (!Number.isInteger(parsed) || String(parsed) !== raw) {
				await submitted.reply({
					content: "Volume must be a whole number.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			if (parsed < DEFAULT_VOLUME_MIN || parsed > DEFAULT_VOLUME_MAX) {
				await submitted.reply({
					content: `Volume must be between ${DEFAULT_VOLUME_MIN} and ${DEFAULT_VOLUME_MAX}.`,
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const updated = await setDefaultVolume(ctx.guild.id, parsed);

			await submitted.reply({
				content: `Default volume updated to \`${updated.defaultVolume}\`. New queues will start at this volume.`,
				flags: MessageFlags.Ephemeral,
			});
			const player = ctx.client.music.getPlayer(ctx.guild.id);
			if (player) player.setVolume(updated.defaultVolume);
			await message
				.edit({
					components: [
						ActionRow().addComponents(
							secondaryButton(`Default Volume: ${updated.defaultVolume}`, EDIT_BUTTON_ID),
						),
					],
				})
				.catch(() => undefined);
		});

		collector.on("end", async () => {
			const latest = await ensureGuild(ctx.guild.id).catch(() => null);
			await message
				.edit({
					components: [
						ActionRow().addComponents(
							secondaryButton(
								`Default Volume: ${latest?.defaultVolume ?? guild.defaultVolume}`,
								EDIT_BUTTON_ID,
								true,
							),
						),
					],
				})
				.catch(() => undefined);
		});
	},
});
