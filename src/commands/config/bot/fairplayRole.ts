import type { RoleSelectMenuInteraction } from "discord.js";
import { ComponentType, MessageFlags, PermissionFlagsBits } from "discord.js";
import { ensureGuild, setFairplayModRole } from "../../../db/stores/guild.js";
import { Middleware } from "../../../middlewares/index.js";
import { defineCommand } from "../../../types/index.js";
import {
	ActionRow,
	defContainer,
	errorContainer,
	RoleSelectMenu,
	TextDisplay,
} from "../../../utils/components.js";
import { logger } from "../../../utils/logger.js";

const ROLE_SELECT_ID = "fairplayrole:select";
const COLLECTOR_TIME = 60_000;

function buildStatusText(roleId: string | null): string {
	return roleId
		? `**The Fairplay Mod role is currently <@&${roleId}>**`
		: "**No Fairplay Mod role is set**";
}

function buildComponents(roleId: string | null, lockAll = false) {
	return [
		defContainer()
			.addTextDisplayComponents(TextDisplay(buildStatusText(roleId)))
			.addTextDisplayComponents(
				TextDisplay("-# Pick a role below, or submit with nothing selected to clear it"),
			)
			.addActionRowComponents(
				ActionRow().addComponents(
					RoleSelectMenu(
						"Select the Fairplay Mod role",
						ROLE_SELECT_ID,
						0,
						1,
						roleId ? [roleId] : [],
						lockAll,
					),
				),
			)
			.addTextDisplayComponents(
				TextDisplay(
					"-# Members with this role can moderate Fairplay alongside members with **Mute Members** permission",
				),
			),
	];
}

async function replyError(
	interaction: RoleSelectMenuInteraction,
	title: string,
	description: string,
): Promise<void> {
	await interaction.reply({
		components: [errorContainer(title, description)],
		flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
	});
}

export default defineCommand({
	name: "fairplayrole",
	aliases: ["fprole"],
	description:
		"Set or clear the role that can moderate Fairplay mode (in addition to Manage Server)",
	category: "meta",
	enabledSlash: true,
	slashData: {
		name: ["config", "fairplayrole"],
		description: "Set or clear the Fairplay Mod role",
	},
	middleware: [
		Middleware.Cooldown(30),
		Middleware.UserPermissions(PermissionFlagsBits.ManageRoles),
	],
	async execute(ctx) {
		const guild = await ensureGuild(ctx.guild.id);
		let roleId = guild.fairplayModRoleId;

		const message = await ctx.reply({
			components: buildComponents(roleId),
			flags: MessageFlags.IsComponentsV2,
		});

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.RoleSelect,
			filter: (i) => i.customId === ROLE_SELECT_ID,
			time: COLLECTOR_TIME,
		});

		collector.on("collect", async (interaction) => {
			if (interaction.user.id !== ctx.user.id) {
				await replyError(interaction, "Not Authorized", "You are not authorized to do this.");
				return;
			}

			if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
				await replyError(
					interaction,
					"Missing Permissions",
					"You no longer have permission to manage this server.",
				);
				return;
			}

			const newRoleId = interaction.values[0] ?? null;
			const updated = await setFairplayModRole(ctx.guild.id, newRoleId);
			roleId = updated.fairplayModRoleId;

			if (roleId !== newRoleId) {
				logger.warn(
					"Config",
					`Fairplay mod role for guild ${ctx.guild.id} requested=${newRoleId ?? "null"} but store returned ${roleId ?? "null"} — check the guilds cache/BaseStore.`,
				);
			}

			await interaction.update({ components: buildComponents(roleId) });
		});

		collector.on("end", async () => {
			await message.edit({ components: buildComponents(roleId, true) }).catch(() => undefined);
		});
	},
});
