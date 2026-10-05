import type { ButtonInteraction, RoleSelectMenuInteraction } from "discord.js";
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
	disableTwentyFourSeven,
	ensureGuild,
	setAutoplayDefault,
	setDefaultVolume,
	setFairplayDefault,
	setFairplayModRole,
	setTwentyFourSeven,
} from "../../../db/stores/guild.js";
import { Middleware } from "../../../middlewares/index.js";
import { premiumService } from "../../../services/premium.js";
import { defineCommand } from "../../../types/index.js";
import {
	ActionRow,
	dangerButton,
	defContainer,
	errorContainer,
	Label,
	Modal,
	RoleSelectMenu,
	secondaryButton,
	successButton,
	TextDisplay,
	TextInput,
} from "../../../utils/components.js";
import { logger } from "../../../utils/logger.js";

const MENU_247_ID = "config:menu:247";
const MENU_FAIRPLAY_ID = "config:menu:fairplay";
const MENU_AUTOPLAY_ID = "config:menu:autoplay";
const MENU_VOLUME_ID = "config:menu:volume";
const BACK_ID = "config:back";
const EDIT_BUTTON_ID = "config:prefix:edit";
const ENABLE_BUTTON_ID = "config:247:enable";
const DISABLE_BUTTON_ID = "config:247:disable";
const ENABLE_FAIRPLAY_BUTTON_ID = "config:fairplay:enable";
const DISABLE_FAIRPLAY_BUTTON_ID = "config:fairplay:disable";
const FAIRPLAY_ROLE_SELECT_ID = "config:fairplay:role";
const ENABLE_AUTOPLAY_BUTTON_ID = "config:autoplay:enable";
const DISABLE_AUTOPLAY_BUTTON_ID = "config:autoplay:disable";
const EDIT_VOLUME_BUTTON_ID = "config:volume:edit";
const VOLUME_MODAL_ID = "config:volume:modal";
const VOLUME_INPUT_ID = "config:volume:input";

const COLLECTOR_TIME = 60_000;

type View = "menu" | "247" | "fairplay" | "autoplay" | "volume";
type ConfigInteraction = ButtonInteraction | RoleSelectMenuInteraction;

function buildMenuComponents(
	lockAll = false,
	hasPremium = true,
	enabled247 = false,
	enabledFairplay = false,
	enabledAutoplay = false,
	volumeValue = DEFAULT_VOLUME_MIN,
) {
	const status = `-# 24/7: \`${enabled247 ? "On" : "Off"}\`\n-# Fairplay: \`${enabledFairplay ? "On" : "Off"}\`\n-# Autoplay: \`${enabledAutoplay ? "On" : "Off"}\`\n-# Volume: \`${volumeValue}\``;

	return [
		defContainer()
			.addTextDisplayComponents(
				TextDisplay(
					hasPremium
						? `**Choose a setting to configure**\n>>> ${status}`
						: `**24/7, Autoplay, and Volume defaults require Server Premium**\n> -# Fairplay: **${enabledFairplay ? "On" : "Off"}**`,
				),
			)
			.addActionRowComponents(
				ActionRow().addComponents(
					secondaryButton("24/7", MENU_247_ID, lockAll || !hasPremium),
					secondaryButton("Fairplay", MENU_FAIRPLAY_ID, lockAll),
				),
			)
			.addActionRowComponents(
				ActionRow().addComponents(
					secondaryButton("Autoplay", MENU_AUTOPLAY_ID, lockAll || !hasPremium),
					secondaryButton("Volume", MENU_VOLUME_ID, lockAll || !hasPremium),
				),
			),
	];
}

function build247StatusText(enabled: boolean): string {
	return enabled
		? "-# 24/7 mode is **enabled**. I'll stay in voice when the queue ends."
		: "-# 24/7 mode is **disabled**. I'll leave voice when the queue ends.";
}

function build247Components(enabled: boolean, lockAll = false) {
	return [
		defContainer()
			.addTextDisplayComponents(TextDisplay(build247StatusText(enabled)))
			.addActionRowComponents(
				ActionRow().addComponents(
					successButton("Enable", ENABLE_BUTTON_ID, lockAll || enabled),
					dangerButton("Disable", DISABLE_BUTTON_ID, lockAll || !enabled),
					secondaryButton("Back", BACK_ID, lockAll),
				),
			),
	];
}

function buildFairplayStatusText(enabled: boolean): string {
	return enabled
		? "-# Fairplay defaults to **on** for every new queue in this server."
		: "-# Fairplay defaults to **off** for new queues. Use `/fairplay` to turn it on per-session.";
}

function buildFairplayRoleStatusText(roleId: string | null): string {
	return roleId
		? `-# Fairplay Mod role: <@&${roleId}> (can moderate Fairplay alongside members with Mute Members Permission).`
		: "-# No Fairplay Mod role set — only members with Mute Members Permission can moderate Fairplay.";
}

function buildFairplayComponents(enabled: boolean, roleId: string | null, lockAll = false) {
	return [
		defContainer()
			.addTextDisplayComponents(TextDisplay(buildFairplayStatusText(enabled)))
			.addActionRowComponents(
				ActionRow().addComponents(
					successButton("Enable", ENABLE_FAIRPLAY_BUTTON_ID, lockAll || enabled),
					dangerButton("Disable", DISABLE_FAIRPLAY_BUTTON_ID, lockAll || !enabled),
					secondaryButton("Back", BACK_ID, lockAll),
				),
			)
			.addTextDisplayComponents(TextDisplay(buildFairplayRoleStatusText(roleId)))
			.addActionRowComponents(
				ActionRow().addComponents(
					RoleSelectMenu(
						"Select Fairplay Mod role (submit empty to clear)",
						FAIRPLAY_ROLE_SELECT_ID,
						0,
						1,
						roleId ? [roleId] : [],
						lockAll,
					),
				),
			),
	];
}

function buildAutoplayStatusText(enabled: boolean): string {
	return enabled
		? "-# Autoplay defaults to **on** for every new queue in this server."
		: "-# Autoplay defaults to **off** for new queues. Use `/autoplay` to turn it on per-session.";
}

function buildAutoplayComponents(enabled: boolean, lockAll = false) {
	return [
		defContainer()
			.addTextDisplayComponents(TextDisplay(buildAutoplayStatusText(enabled)))
			.addActionRowComponents(
				ActionRow().addComponents(
					successButton("Enable", ENABLE_AUTOPLAY_BUTTON_ID, lockAll || enabled),
					dangerButton("Disable", DISABLE_AUTOPLAY_BUTTON_ID, lockAll || !enabled),
					secondaryButton("Back", BACK_ID, lockAll),
				),
			),
	];
}

function buildVolumeComponents(volume: number, lockAll = false) {
	return [
		defContainer()
			.addTextDisplayComponents(
				TextDisplay(`-# New queues in this server start at \`${volume}\` volume.`),
			)
			.addActionRowComponents(
				ActionRow().addComponents(
					secondaryButton("Edit Volume", EDIT_VOLUME_BUTTON_ID, lockAll),
					secondaryButton("Back", BACK_ID, lockAll),
				),
			),
	];
}

async function replyError(
	interaction: ConfigInteraction,
	title: string,
	description: string,
): Promise<void> {
	await interaction.reply({
		components: [errorContainer(title, description)],
		flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
	});
}

export default defineCommand({
	name: "config",
	aliases: ["settings", "cfg"],
	description: "Configure server settings",
	category: "meta",
	enabledSlash: true,
	slashData: {
		name: "config",
		description: "Configure server settings",
	},
	middleware: [
		Middleware.Cooldown(30),
		Middleware.UserPermissions(PermissionFlagsBits.ManageGuild),
	],
	async execute(ctx) {
		let view: View = "menu";
		let enabled247 = (await ensureGuild(ctx.guild.id)).twentyFourSeven;
		let enabledFairplay = (await ensureGuild(ctx.guild.id)).fairplayDefault;
		let fairplayModRoleId = (await ensureGuild(ctx.guild.id)).fairplayModRoleId;
		let enabledAutoplay = (await ensureGuild(ctx.guild.id)).autoplayDefault;
		let volumeValue = (await ensureGuild(ctx.guild.id)).defaultVolume;
		const hasPremium = await premiumService.hasServerPremium(ctx.guild.id);

		const message = await ctx.reply({
			components: buildMenuComponents(
				false,
				hasPremium,
				enabled247,
				enabledFairplay,
				enabledAutoplay,
				volumeValue,
			),
			flags: MessageFlags.IsComponentsV2,
		});

		const collector = message.createMessageComponentCollector({
			filter: (i) =>
				[
					MENU_247_ID,
					MENU_FAIRPLAY_ID,
					MENU_AUTOPLAY_ID,
					MENU_VOLUME_ID,
					BACK_ID,
					EDIT_BUTTON_ID,
					ENABLE_BUTTON_ID,
					DISABLE_BUTTON_ID,
					ENABLE_FAIRPLAY_BUTTON_ID,
					DISABLE_FAIRPLAY_BUTTON_ID,
					FAIRPLAY_ROLE_SELECT_ID,
					ENABLE_AUTOPLAY_BUTTON_ID,
					DISABLE_AUTOPLAY_BUTTON_ID,
					EDIT_VOLUME_BUTTON_ID,
				].includes(i.customId),
			time: COLLECTOR_TIME,
		});

		const handleEditVolume = async (button: ButtonInteraction): Promise<void> => {
			await button.showModal(
				Modal(VOLUME_MODAL_ID, "Edit Default Volume").addLabelComponents(
					Label(
						`Volume (${DEFAULT_VOLUME_MIN}-${DEFAULT_VOLUME_MAX})`,
						TextInput(VOLUME_INPUT_ID, TextInputStyle.Short, true)
							.setMaxLength(4)
							.setValue(String(volumeValue))
							.setPlaceholder("e.g. 100"),
						`A whole number between ${DEFAULT_VOLUME_MIN} and ${DEFAULT_VOLUME_MAX}`,
					),
				),
			);

			let submitted: ModalSubmitInteraction | undefined;
			try {
				submitted = await button.awaitModalSubmit({
					filter: (m) => m.customId === VOLUME_MODAL_ID && m.user.id === ctx.user.id,
					time: COLLECTOR_TIME,
				});
			} catch {
				return;
			}

			const raw = submitted.fields.getTextInputValue(VOLUME_INPUT_ID).trim();
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
			volumeValue = updated.defaultVolume;

			await submitted.reply({
				content: `Default volume updated to \`${volumeValue}\`. New queues will start at this volume.`,
				flags: MessageFlags.Ephemeral,
			});

			await message.edit({ components: buildVolumeComponents(volumeValue) }).catch(() => undefined);
		};

		const handleEnable247 = async (button: ButtonInteraction): Promise<void> => {
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

			enabled247 = updated.twentyFourSeven;
			if (!enabled247) {
				logger.warn(
					"Config",
					`24/7 enable requested for guild ${ctx.guild.id} but the store returned false — check the guilds cache/BaseStore.`,
				);
			}

			await button.update({ components: build247Components(enabled247) });
		};

		const handleDisable247 = async (button: ButtonInteraction): Promise<void> => {
			const updated = await disableTwentyFourSeven(ctx.guild.id);
			enabled247 = updated.twentyFourSeven;
			await button.update({ components: build247Components(enabled247) });
		};

		const handleFairplayDefault = async (
			button: ButtonInteraction,
			target: boolean,
		): Promise<void> => {
			const updated = await setFairplayDefault(ctx.guild.id, target);

			enabledFairplay = updated.fairplayDefault;
			if (enabledFairplay !== target) {
				logger.warn(
					"Config",
					`Fairplay default for guild ${ctx.guild.id} requested=${target} but store returned ${enabledFairplay} — check the guilds cache/BaseStore.`,
				);
			}

			const player = ctx.client.music.getPlayer(ctx.guild.id);
			if (player) player.setFairplay(enabledFairplay);

			await button.update({
				components: buildFairplayComponents(enabledFairplay, fairplayModRoleId),
			});
		};

		const handleFairplayRoleSelect = async (select: RoleSelectMenuInteraction): Promise<void> => {
			const newRoleId = select.values[0] ?? null;
			const updated = await setFairplayModRole(ctx.guild.id, newRoleId);

			fairplayModRoleId = updated.fairplayModRoleId;
			if (fairplayModRoleId !== newRoleId) {
				logger.warn(
					"Config",
					`Fairplay mod role for guild ${ctx.guild.id} requested=${newRoleId ?? "null"} but store returned ${fairplayModRoleId ?? "null"} — check the guilds cache/BaseStore.`,
				);
			}

			await select.update({
				components: buildFairplayComponents(enabledFairplay, fairplayModRoleId),
			});
		};

		const handleAutoplayDefault = async (
			button: ButtonInteraction,
			target: boolean,
		): Promise<void> => {
			const updated = await setAutoplayDefault(ctx.guild.id, target);

			enabledAutoplay = updated.autoplayDefault;
			if (enabledAutoplay !== target) {
				logger.warn(
					"Config",
					`Autoplay default for guild ${ctx.guild.id} requested=${target} but store returned ${enabledAutoplay} — check the guilds cache/BaseStore.`,
				);
			}

			const player = ctx.client.music.getPlayer(ctx.guild.id);
			if (player) player.setAutoplay(enabledAutoplay);

			await button.update({ components: buildAutoplayComponents(enabledAutoplay) });
		};

		collector.on("collect", async (interaction) => {
			const isRoleSelect = interaction.componentType === ComponentType.RoleSelect;
			const configInteraction = interaction as ConfigInteraction;

			if (configInteraction.user.id !== ctx.user.id) {
				await replyError(configInteraction, "Not Authorized", "You are not authorized to do this.");
				return;
			}

			if (!configInteraction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
				await replyError(
					configInteraction,
					"Missing Permissions",
					"You no longer have permission to manage this server.",
				);
				return;
			}

			if (isRoleSelect) {
				await handleFairplayRoleSelect(configInteraction as RoleSelectMenuInteraction);
				return;
			}

			const button = configInteraction as ButtonInteraction;

			switch (button.customId) {
				case MENU_247_ID: {
					if (!hasPremium) {
						await replyError(
							button,
							"Premium Required",
							"24/7 mode requires Server Premium. Use the premium command to view plans and activate.",
						);
						return;
					}
					view = "247";
					enabled247 = (await ensureGuild(ctx.guild.id)).twentyFourSeven;
					await button.update({ components: build247Components(enabled247) });
					return;
				}
				case MENU_FAIRPLAY_ID: {
					view = "fairplay";
					const freshGuild = await ensureGuild(ctx.guild.id);
					enabledFairplay = freshGuild.fairplayDefault;
					fairplayModRoleId = freshGuild.fairplayModRoleId;
					await button.update({
						components: buildFairplayComponents(enabledFairplay, fairplayModRoleId),
					});
					return;
				}
				case MENU_AUTOPLAY_ID: {
					if (!hasPremium) {
						await replyError(
							button,
							"Premium Required",
							"Autoplay defaults require Server Premium. Use the premium command to view plans and activate.",
						);
						return;
					}
					view = "autoplay";
					enabledAutoplay = (await ensureGuild(ctx.guild.id)).autoplayDefault;
					await button.update({ components: buildAutoplayComponents(enabledAutoplay) });
					return;
				}
				case MENU_VOLUME_ID: {
					if (!hasPremium) {
						await replyError(
							button,
							"Premium Required",
							"Default volume requires Server Premium. Use the premium command to view plans and activate.",
						);
						return;
					}
					view = "volume";
					volumeValue = (await ensureGuild(ctx.guild.id)).defaultVolume;
					await button.update({ components: buildVolumeComponents(volumeValue) });
					return;
				}
				case BACK_ID: {
					view = "menu";
					await button.update({
						components: buildMenuComponents(
							false,
							hasPremium,
							enabled247,
							enabledFairplay,
							enabledAutoplay,
							volumeValue,
						),
					});
					return;
				}
				case ENABLE_BUTTON_ID: {
					await handleEnable247(button);
					return;
				}
				case DISABLE_BUTTON_ID: {
					await handleDisable247(button);
					return;
				}
				case ENABLE_FAIRPLAY_BUTTON_ID: {
					await handleFairplayDefault(button, true);
					return;
				}
				case DISABLE_FAIRPLAY_BUTTON_ID: {
					await handleFairplayDefault(button, false);
					return;
				}
				case ENABLE_AUTOPLAY_BUTTON_ID: {
					await handleAutoplayDefault(button, true);
					return;
				}
				case DISABLE_AUTOPLAY_BUTTON_ID: {
					await handleAutoplayDefault(button, false);
					return;
				}
				case EDIT_VOLUME_BUTTON_ID: {
					await handleEditVolume(button);
				}
			}
		});

		collector.on("end", async () => {
			const locked =
				view === "247"
					? build247Components(enabled247, true)
					: view === "fairplay"
						? buildFairplayComponents(enabledFairplay, fairplayModRoleId, true)
						: view === "autoplay"
							? buildAutoplayComponents(enabledAutoplay, true)
							: view === "volume"
								? buildVolumeComponents(volumeValue, true)
								: buildMenuComponents(
										true,
										hasPremium,
										enabled247,
										enabledFairplay,
										enabledAutoplay,
										volumeValue,
									);

			await message.edit({ components: locked }).catch(() => undefined);
		});
	},
});
