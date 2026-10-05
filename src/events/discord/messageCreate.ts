import { type Message, MessageFlags } from "discord.js";
import { config } from "../../config/config.js";
import { PrefixCommandContext } from "../../structures/context/index.js";
import { type Command, defineEvent } from "../../types/index.js";
import { defContainer, errorContainer, TextDisplay } from "../../utils/components.js";
import { logger } from "../../utils/logger.js";
import { canBotSendMessages } from "../../utils/permissions.js";
import { runMiddlewares } from "../../utils/runMiddlewares.js";

const botRegex = new RegExp(`^<@!?${config.clientId}>`);

function resolveContent(message: Message<true>): string | null {
	const isDirectMention =
		botRegex.test(message.content) && message.mentions.users.has(config.clientId);

	if (!isDirectMention) return null;
	return message.content.replace(botRegex, "").trim();
}

async function sendPrefixHint(message: Message<true>): Promise<void> {
	const container = defContainer().addTextDisplayComponents(
		TextDisplay(`Hey <@${message.author.id}>, mention me to use commands!`),
		TextDisplay(`-# use \`/help\` or <@${message.client.user.id}> \`help\` to see all commands`),
	);
	await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {
		// empty because errors are intentionally ignored
	});
}

async function sendError(
	message: Message<true>,
	title: string,
	description: string,
): Promise<void> {
	const container = errorContainer(title, description);
	await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {
		// empty because errors here are intentionally ignored
	});
}

export default defineEvent({
	name: "messageCreate",
	async execute(client, message) {
		if (message.author.bot || !message.inGuild()) return;
		if (!canBotSendMessages(message.channel)) return;

		const runResolved = async (command: Command, commandArgs: string[]): Promise<void> => {
			const ctx = new PrefixCommandContext(client, message, commandArgs);
			const result = await runMiddlewares(ctx, command);

			if (!result.ok) {
				if (result.silent) return;
				await sendError(message, result.error.title, result.error.description);
				return;
			}

			try {
				await command.execute(ctx);
			} catch (error) {
				logger.error(
					"MessageCreate",
					`Error executing ${Array.isArray(command.name) ? command.name.join(" ") : command.name}`,
					error as Error,
				);
				await sendError(
					message,
					"Command Error",
					"An unexpected error occurred while running this command.",
				);
			}
		};

		const contentToParse = resolveContent(message);

		if (contentToParse === null) return;

		if (!contentToParse) {
			await sendPrefixHint(message);
			return;
		}

		const args = contentToParse.split(/\s+/);
		const resolved = client.commands.resolvePrefixCommand(args);
		if (!resolved) return;

		await runResolved(resolved.command, resolved.args);
	},
});
