import {
	type AutocompleteInteraction,
	type ButtonInteraction,
	type ChatInputCommandInteraction,
	MessageFlags,
} from "discord.js";
import type { BotClient } from "../../core/BotClient.js";
import { SlashCommandContext } from "../../structures/context/index.js";
import { defineEvent } from "../../types/index.js";
import {
	defContainer,
	errorContainer,
	Separator,
	successContainer,
	TextDisplay,
} from "../../utils/components.js";
import { logger } from "../../utils/logger.js";
import { canBotSendMessages } from "../../utils/permissions.js";
import {
	handlePlayerButtonInteraction,
	handlePlayerSettingsModalSubmit,
	isPlayerButtonInteraction,
	isPlayerSettingsModalId,
} from "../../utils/playerButtons/index.js";
import { runMiddlewares } from "../../utils/runMiddlewares.js";

async function handlePlayCommandButtons(interaction: ButtonInteraction): Promise<void> {
	await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {
		/** empty because errors from deferReply are intentionally ignored */
	});

	if (!interaction.inCachedGuild()) return;

	const client = interaction.client as BotClient;
	const encoded = interaction.customId.split(":")[1];
	if (!encoded) return;

	const player = client.music.getPlayer(interaction.guildId);
	if (!player) {
		await interaction
			.editReply({
				components: [errorContainer("No Player", "No player found.")],
				flags: MessageFlags.IsComponentsV2,
			})
			.catch(() => {
				/** empty because errors are intentionally ignored */
			});
		return;
	}

	const voiceChannelId = interaction.member.voice.channelId;
	if (!voiceChannelId || voiceChannelId !== player.voiceChannelId) {
		await interaction
			.editReply({
				components: [
					errorContainer(
						"Wrong Voice Channel",
						"You need to be in the same voice channel as the bot to do this.",
					),
				],
				flags: MessageFlags.IsComponentsV2,
			})
			.catch(() => {
				/** empty because errors are intentionally ignored */
			});
		return;
	}

	const matches = player.queue.findAllByEncodedContains(encoded);
	if (matches.length === 0) {
		await interaction
			.editReply({
				components: [errorContainer("Not Found", "This track is no longer in the queue.")],
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			})
			.catch(() => {
				/** empty because promise rejection is intentionally ignored */
			});
		return;
	}

	let target = matches[0] as (typeof matches)[number];
	if (matches.length > 1) {
		const reference = interaction.message.createdTimestamp;
		for (const candidate of matches) {
			const currentDiff = Math.abs(target.addedAt - reference);
			const candidateDiff = Math.abs(candidate.addedAt - reference);
			if (candidateDiff < currentDiff) target = candidate;
		}
	}

	const index = player.queue.indexOf(target);
	if (index === -1) {
		await interaction
			.editReply({
				components: [errorContainer("Not Found", "This track is no longer in the queue.")],
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			})
			.catch(() => {
				/** empty because errors are intentionally ignored */
			});
		return;
	}

	player.queue.remove(index);

	const { title, uri, author } = target.info;
	const container = defContainer()
		.addTextDisplayComponents(TextDisplay("Removed from Queue"))
		.addSeparatorComponents(Separator())
		.addTextDisplayComponents(
			TextDisplay([`**[${title}](${uri})**`, author].filter(Boolean).join("\n")),
		);

	await interaction.message
		.edit({ components: [container], flags: MessageFlags.IsComponentsV2 })
		.catch(() => {
			/** empty because errors are intentionally ignored */
		});
	await interaction.editReply({
		components: [
			successContainer().addTextDisplayComponents(
				TextDisplay("### The song has been removed from the queue."),
			),
		],
		flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
	});
}
async function handleChatInput(
	client: BotClient,
	interaction: ChatInputCommandInteraction,
): Promise<void> {
	await interaction.deferReply().catch(() => {
		/** empty because errors during deferReply can be safely ignored */
	});

	if (!interaction.inCachedGuild()) {
		await interaction
			.editReply({
				components: [
					errorContainer("Not in a server", "This command can only be used in a server."),
				],
				flags: MessageFlags.IsComponentsV2,
			})
			.catch(() => {
				/** empty because errors are intentionally ignored */
			});
		return;
	}

	const subCommandGroup = interaction.options.getSubcommandGroup(false);
	const subCommand = interaction.options.getSubcommand(false);
	const command = client.commands.getSlashCommandFile(
		interaction.commandName,
		subCommandGroup,
		subCommand,
	);

	if (!command) {
		logger.warn("InteractionCreate", `No command file found for /${interaction.commandName}`);
		await interaction
			.editReply({
				components: [
					errorContainer("Command not found", "This command is outdated or improperly configured."),
				],
				flags: MessageFlags.IsComponentsV2,
			})
			.catch(() => {
				/** empty because errors are intentionally ignored */
			});
		return;
	}

	if (!canBotSendMessages(interaction.channel)) {
		await interaction
			.editReply({
				components: [
					errorContainer(
						"No permission",
						"I don't have permission to send messages in this channel.",
					),
				],
				flags: MessageFlags.IsComponentsV2,
			})
			.catch(() => {
				/** empty because intentionally ignoring errors */
			});
		return;
	}

	const ctx = new SlashCommandContext(client, interaction);
	const result = await runMiddlewares(ctx, command);

	if (!result.ok) {
		if (result.silent) {
			await interaction.deleteReply().catch(() => {
				/** empty because errors are intentionally ignored */
			});
			return;
		}

		const container = errorContainer(result.error.title, result.error.description);
		await interaction
			.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 })
			.catch(() => {
				// empty because intentionally ignoring errors
			});
		return;
	}

	try {
		await command.execute(ctx);
	} catch (error) {
		logger.error(
			"InteractionCreate",
			`Error executing /${interaction.commandName}`,
			error as Error,
		);
		const container = errorContainer(
			"Command Error",
			"An unexpected error occurred while running this command.",
		);
		await interaction
			.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 })
			.catch(() => {
				// empty because errors are intentionally ignored
			});
	}
}

async function handleAutocomplete(
	client: BotClient,
	interaction: AutocompleteInteraction,
): Promise<void> {
	const subCommandGroup = interaction.options.getSubcommandGroup(false);
	const subCommand = interaction.options.getSubcommand(false);
	const command = client.commands.getSlashCommandFile(
		interaction.commandName,
		subCommandGroup,
		subCommand,
	);
	if (!command?.autocomplete) return;
	try {
		await command.autocomplete(interaction, client);
	} catch (error) {
		logger.error(
			"InteractionCreate",
			`Autocomplete error for /${interaction.commandName}`,
			error as Error,
		);
	}
}

export default defineEvent({
	name: "interactionCreate",
	async execute(client, interaction) {
		if (interaction.isChatInputCommand()) {
			await handleChatInput(client, interaction);
		} else if (interaction.isAutocomplete()) {
			await handleAutocomplete(client, interaction);
		} else if (interaction.isButton() && interaction.customId.startsWith("playRemove")) {
			await handlePlayCommandButtons(interaction);
		} else if (interaction.isButton() && isPlayerButtonInteraction(interaction.customId)) {
			await handlePlayerButtonInteraction(interaction, client);
		} else if (interaction.isModalSubmit() && isPlayerSettingsModalId(interaction.customId)) {
			await handlePlayerSettingsModalSubmit(interaction, client);
		}
	},
});
