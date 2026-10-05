import {
	type AutocompleteInteraction,
	type MessageComponentInteraction,
	MessageFlags,
	PermissionFlagsBits,
	type SelectMenuComponentOptionData,
} from "discord.js";
import {
	type APIApplicationCommandBasicOption,
	ApplicationCommandOptionType,
} from "discord-api-types/v10";
//import { config } from "../../../config/config.js";
import type { BotClient } from "../../../core/BotClient.js";
import { Middleware } from "../../../middlewares/index.js";
import type { CommandContext } from "../../../structures/context/index.js";
import {
	type Command,
	type CommandName,
	defineCommand,
	type SlashCommandData,
} from "../../../types/index.js";
import {
	ActionRow,
	defContainer,
	errorContainer,
	//linkButton,
	primaryButton,
	SelectMenu,
	Separator,
	secondaryButton,
	TextDisplay,
} from "../../../utils/components.js";
import { logger } from "../../../utils/logger.js";

const COMMANDS_PER_PAGE = 8;
const COLLECTOR_TIME = 300_000;
const MIN_SEARCH_SCORE = 30;

const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
	clear: ["remove", "delete", "empty", "clean", "reset"],
	queue: ["list", "playlist", "songs", "tracks", "q"],
	skip: ["next", "forward", "pass"],
	stop: ["end", "halt", "cease", "terminate", "disconnect"],
	pause: ["hold", "freeze", "wait"],
	resume: ["continue", "unpause", "restart"],
	play: ["start", "begin", "run"],
	volume: ["sound", "loud", "quiet", "audio", "vol"],
	seek: ["jump", "goto", "position", "rewind", "fastforward"],
	shuffle: ["random", "mix", "randomize"],
	loop: ["repeat", "cycle"],
	show: ["display", "view", "list", "see", "get"],
	help: ["guide", "info", "information", "how", "commands"],
	search: ["find", "lookup", "query"],
	join: ["connect", "summon"],
	leave: ["disconnect", "bye", "quit"],
	nowplaying: ["np", "current", "playing", "now"],
	autoplay: ["auto", "related", "suggestions"],
	filters: ["equalizer", "eq", "bass", "effects"],
	favorites: ["favs", "liked", "saved", "bookmarks", "favourite"],
	add: ["save", "insert", "put", "include"],
	song: ["track", "music", "audio"],
};

const FILLER_WORDS: ReadonlySet<string> = new Set([
	"how",
	"to",
	"do",
	"i",
	"the",
	"a",
	"an",
	"and",
	"or",
	"for",
	"can",
	"please",
	"my",
	"is",
	"are",
	"what",
	"where",
	"when",
	"why",
	"which",
	"who",
	"with",
	"from",
	"in",
	"on",
	"at",
]);

type HelpView =
	| { kind: "overview"; category: string | null; page: number }
	| { kind: "details"; command: Command; category: string | null; page: number }
	| { kind: "search"; query: string; results: Command[] }
	| { kind: "not_found"; query: string };

function commandKey(name: CommandName): string {
	return Array.isArray(name) ? name.join(":").toLowerCase() : name.toLowerCase();
}

function commandDisplayName(name: CommandName): string {
	return Array.isArray(name) ? name.join(" ") : name;
}

const HIDDEN_CATEGORIES = ["dev", "owner"] as const;

function isHidden(command: Command): boolean {
	const category = command.category?.toLowerCase();
	if (!category) return false;
	return HIDDEN_CATEGORIES.some((hidden) => category.includes(hidden));
}

function truncate(text: string, maxLength: number): string {
	if (!text) return "";
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 3)}...`;
}

function formatCategoryName(name: string): string {
	return name
		.split(/[-_]/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

function formatPermissionBit(bit: bigint): string {
	const entry = Object.entries(PermissionFlagsBits).find(([, value]) => value === bit);
	const name = entry?.[0] ?? bit.toString();
	return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function toBigIntPermission(
	value: NonNullable<SlashCommandData["defaultMemberPermissions"]>,
): bigint {
	if (typeof value === "bigint") return value;
	if (typeof value === "number") return BigInt(value);
	return value.bitfield;
}

function formatOptionType(type: ApplicationCommandOptionType): string {
	switch (type) {
		case ApplicationCommandOptionType.Subcommand:
			return "Subcommand";
		case ApplicationCommandOptionType.SubcommandGroup:
			return "Subcommand Group";
		case ApplicationCommandOptionType.String:
			return "String";
		case ApplicationCommandOptionType.Integer:
			return "Integer";
		case ApplicationCommandOptionType.Boolean:
			return "Boolean";
		case ApplicationCommandOptionType.User:
			return "User";
		case ApplicationCommandOptionType.Channel:
			return "Channel";
		case ApplicationCommandOptionType.Role:
			return "Role";
		case ApplicationCommandOptionType.Mentionable:
			return "Mentionable";
		case ApplicationCommandOptionType.Number:
			return "Number";
		case ApplicationCommandOptionType.Attachment:
			return "Attachment";
		default:
			return "Unknown";
	}
}

function toSelectOption(
	label: string,
	value: string,
	description: string,
): SelectMenuComponentOptionData {
	return {
		label: truncate(label, 100),
		value,
		description: truncate(description, 100),
	};
}

function visibleCommands(client: BotClient): Command[] {
	return Array.from(client.commands.commands.values()).filter((command) => !isHidden(command));
}

function visibleCategories(client: BotClient): Map<string, Command[]> {
	const result = new Map<string, Command[]>();
	for (const [category, commands] of client.commands.categories) {
		const lower = category.toLowerCase();
		if (HIDDEN_CATEGORIES.some((hidden) => lower.includes(hidden))) continue;
		const filtered = commands.filter((command) => !isHidden(command));
		if (filtered.length > 0) result.set(category, filtered);
	}
	return result;
}

function findCategoryOf(client: BotClient, command: Command): string | null {
	for (const [category, commands] of visibleCategories(client)) {
		if (commands.includes(command)) return category;
	}
	return null;
}

function findCommandByQuery(client: BotClient, rawQuery: string): Command | null {
	const query = rawQuery.trim().toLowerCase();
	if (!query) return null;

	const colonKey = query.replace(/\s+/g, ":");
	const byColonKey = client.commands.commands.get(colonKey);
	if (byColonKey && !isHidden(byColonKey)) return byColonKey;

	const byAliasOrKey = client.commands.get(query);
	if (byAliasOrKey && !isHidden(byAliasOrKey)) return byAliasOrKey;

	for (const command of client.commands.commands.values()) {
		if (isHidden(command)) continue;
		if (commandDisplayName(command.name).toLowerCase() === query) return command;
	}

	return null;
}

function extractKeywords(query: string): string[] {
	return query
		.toLowerCase()
		.split(/\s+/)
		.filter((term) => term.length > 1 && !FILLER_WORDS.has(term));
}

function synonymScore(term: string, haystack: string): number {
	let score = 0;
	const direct = SYNONYMS[term];
	if (direct) {
		for (const synonym of direct) {
			if (haystack.includes(synonym)) score += 5;
		}
	}
	for (const [key, values] of Object.entries(SYNONYMS)) {
		if (values.includes(term) && haystack.includes(key)) score += 5;
	}
	return score;
}

function scoreCommand(command: Command, keywords: string[]): number {
	const name = commandDisplayName(command.name).toLowerCase();
	const description = (command.description ?? "").toLowerCase();
	const aliases = (command.aliases ?? []).map((alias) => alias.toLowerCase());
	const haystack = `${name} ${description}`;
	const descriptionWords = description.split(/\s+/);

	let score = 0;
	for (const keyword of keywords) {
		if (name.includes(keyword)) score += 100;
		if (aliases.some((alias) => alias.includes(keyword))) score += 80;
		if (descriptionWords.includes(keyword)) score += 50;
		else if (description.includes(keyword)) score += 25;
		score += synonymScore(keyword, haystack);
	}
	return score;
}

function searchCommands(client: BotClient, query: string): Command[] {
	const commands = visibleCommands(client);
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

	const exact = commands.filter((command) => {
		const name = commandDisplayName(command.name).toLowerCase();
		const aliases = (command.aliases ?? []).map((alias) => alias.toLowerCase());
		return terms.some((term) => term === name || aliases.includes(term));
	});
	if (exact.length > 0) return exact;

	const keywords = extractKeywords(query);
	if (keywords.length === 0) return [];

	const scored = commands
		.map((command) => ({ command, score: scoreCommand(command, keywords) }))
		.filter((entry) => entry.score >= MIN_SEARCH_SCORE)
		.sort((a, b) => b.score - a.score);

	return scored.slice(0, 25).map((entry) => entry.command);
}

function buildCategoryRows(
	categories: Map<string, Command[]>,
	selected: string | null,
	disabled: boolean,
) {
	const names = Array.from(categories.keys()).sort();
	const rows = [];

	for (let i = 0; i < names.length; i += 4) {
		const row = ActionRow();
		for (const name of names.slice(i, i + 4)) {
			const isSelected = name === selected;
			row.addComponents(
				isSelected
					? primaryButton(formatCategoryName(name), `hcat|${name}`, disabled)
					: secondaryButton(formatCategoryName(name), `hcat|${name}`, disabled),
			);
		}
		rows.push(row);
	}

	return rows;
}

function buildOverviewContainer(
	client: BotClient,
	category: string | null,
	page: number,
	disabled = false,
) {
	const container = defContainer();
	const categories = visibleCategories(client);

	container.addTextDisplayComponents(TextDisplay(`### Command Library`));
	container.addSeparatorComponents(Separator());

	for (const row of buildCategoryRows(categories, category, disabled)) {
		container.addActionRowComponents(row);
	}

	const commands = category ? categories.get(category) : undefined;

	if (category && commands) {
		container.addSeparatorComponents(Separator());

		const pageCount = Math.max(1, Math.ceil(commands.length / COMMANDS_PER_PAGE));
		const safePage = Math.min(Math.max(0, page), pageCount - 1);
		const start = safePage * COMMANDS_PER_PAGE;
		const pageCommands = commands.slice(start, start + COMMANDS_PER_PAGE);

		const lines = pageCommands.map((command) => {
			const name = commandDisplayName(command.name);
			const description = truncate(command.description ?? "No description", 60);
			return `- **${name}** - ${description}`;
		});

		container.addTextDisplayComponents(TextDisplay(`${lines.join("\n")}`));

		const seenValues = new Set<string>();
		const options = pageCommands
			.map((command) =>
				toSelectOption(
					commandDisplayName(command.name),
					commandKey(command.name),
					command.description ?? "No description available",
				),
			)
			.filter((option) => {
				if (seenValues.has(option.value)) return false;
				seenValues.add(option.value);
				return true;
			});

		container.addActionRowComponents(
			ActionRow().addComponents(
				SelectMenu(
					"Select a command for details",
					options,
					`hcmd|${category}|${safePage}`,
					1,
					1,
					disabled,
				),
			),
		);

		const navRow = ActionRow();
		navRow.addComponents(
			secondaryButton("Previous", `hnav|${category}|${safePage}|prev`, disabled || safePage === 0),
			secondaryButton(
				"Next",
				`hnav|${category}|${safePage}|next`,
				disabled || safePage >= pageCount - 1,
			),
		);
		container.addActionRowComponents(navRow);
	} else {
		//	const linkRow = ActionRow();
		//	if (config?.links?.invite) linkRow.addComponents(linkButton("Invite Bot", config.links.invite));
		//if (config?.links?.supportServer) {
		//linkRow.addComponents(linkButton("Support Server", config.links.supportServer));
		//}
		//if (linkRow.components.length > 0) container.addActionRowComponents(linkRow);
	}

	return container;
}

function formatSlashOption(option: APIApplicationCommandBasicOption): string {
	const requirement = option.required ? "Required" : "Optional";
	const type = formatOptionType(option.type);
	let line = `> \`${option.name}\` [${requirement}, ${type}]`;
	if (option.description) line += ` - ${option.description}`;
	if ("choices" in option && option.choices && option.choices.length > 0) {
		line += `\n> Choices: ${option.choices.map((choice) => `\`${choice.name}\``).join(", ")}`;
	}
	return line;
}

function formatSlashDetails(slashData: SlashCommandData): string {
	const fullName = Array.isArray(slashData.name)
		? `/${slashData.name.join(" ")}`
		: `/${slashData.name}`;
	const lines: string[] = [`### ${fullName}`, slashData.description];

	if (slashData.defaultMemberPermissions != null) {
		const bit = toBigIntPermission(slashData.defaultMemberPermissions);
		lines.push(`- **Required Permission:** ${formatPermissionBit(bit)}`);
	}

	if (slashData.options && slashData.options.length > 0) {
		lines.push("- **Options:**");
		for (const option of slashData.options) {
			lines.push(formatSlashOption(option));
		}
	}

	return lines.join("\n");
}

function collectRequirements(command: Command): string[] {
	return (command.middleware ?? [])
		.map((middleware) => middleware.label)
		.filter((label): label is string => Boolean(label));
}

function formatCommandDetails(command: Command): string {
	const sections: string[] = [command.description ?? "No description available"];

	if (command.usage) sections.push(`> **Usage:** \`${command.usage}\``);

	if (command.slashUsage) sections.push(`> **Slash Usage:** \`${command.slashUsage}\``);

	if (command.aliases && command.aliases.length > 0) {
		sections.push(`> **Aliases:** ${command.aliases.map((alias) => `\`${alias}\``).join(", ")}`);
	}

	if (command.examples && command.examples.length > 0) {
		const label = command.examples.length === 1 ? "Example" : "Examples";
		sections.push(
			`> **${label}:** ${command.examples.map((example) => `\`${example}\``).join(", ")}`,
		);
	}

	const requirements = collectRequirements(command);
	if (requirements.length > 0) {
		sections.push(`> **Requirements:** ${requirements.join(", ")}`);
	}

	if (command.category) {
		sections.push(`> **Category:** ${formatCategoryName(command.category)}`);
	}

	return sections.join("\n");
}

function buildCommandDetailsContainer(
	command: Command,
	category: string | null,
	page: number,
	disabled = false,
) {
	const container = defContainer();
	const name = commandDisplayName(command.name);

	container.addTextDisplayComponents(TextDisplay(`## ${name}`));
	container.addSeparatorComponents(Separator());
	container.addTextDisplayComponents(TextDisplay(formatCommandDetails(command)));

	if (command.enabledSlash && command.slashData) {
		container.addSeparatorComponents(Separator());
		container.addTextDisplayComponents(TextDisplay(formatSlashDetails(command.slashData)));
	}

	container.addSeparatorComponents(Separator());
	container.addActionRowComponents(
		ActionRow().addComponents(
			secondaryButton("Back to Commands", `hback|${category ?? ""}|${page}`, disabled),
		),
	);

	return container;
}

function buildSearchResultsContainer(query: string, results: Command[], disabled = false) {
	const container = defContainer();

	container.addTextDisplayComponents(TextDisplay("## Search Results"));
	container.addSeparatorComponents(Separator());
	container.addTextDisplayComponents(
		TextDisplay(
			`Query: \`${query}\`\n\nFound **${results.length}** ${results.length === 1 ? "command" : "commands"}`,
		),
	);
	container.addSeparatorComponents(Separator());

	const options = results
		.slice(0, 25)
		.map((command) =>
			toSelectOption(
				commandDisplayName(command.name),
				commandKey(command.name),
				command.description ?? "No description available",
			),
		);

	if (options.length > 0) {
		container.addActionRowComponents(
			ActionRow().addComponents(
				SelectMenu("Select a command to view details", options, "hsearch", 1, 1, disabled),
			),
		);
	}

	return container;
}

function buildNotFoundContainer(query: string) {
	return errorContainer("Command Not Found", `No command matching \`${query}\` was found.`);
}

function renderView(client: BotClient, view: HelpView, disabled = false) {
	switch (view.kind) {
		case "overview":
			return buildOverviewContainer(client, view.category, view.page, disabled);
		case "details":
			return buildCommandDetailsContainer(view.command, view.category, view.page, disabled);
		case "search":
			return buildSearchResultsContainer(view.query, view.results, disabled);
		case "not_found":
			return buildNotFoundContainer(view.query);
	}
}

function resolveNextView(
	client: BotClient,
	interaction: MessageComponentInteraction,
): HelpView | null {
	const [action, ...parts] = interaction.customId.split("|");

	if (interaction.isStringSelectMenu()) {
		const value = interaction.values[0];
		if (!value) return null;

		if (action === "hcmd") {
			const category = parts[0] || null;
			const page = Number.parseInt(parts[1] ?? "0", 10) || 0;
			const command = client.commands.commands.get(value);
			if (!command) return { kind: "overview", category, page };
			return { kind: "details", command, category, page };
		}

		if (action === "hsearch") {
			const command = client.commands.commands.get(value);
			if (!command) return null;
			return { kind: "details", command, category: findCategoryOf(client, command), page: 0 };
		}

		return null;
	}

	if (!interaction.isButton()) return null;

	if (action === "hcat") {
		const category = parts[0] || null;
		return { kind: "overview", category, page: 0 };
	}

	if (action === "hnav") {
		const category = parts[0] || null;
		const page = Number.parseInt(parts[1] ?? "0", 10) || 0;
		const direction = parts[2] === "next" ? 1 : -1;
		return { kind: "overview", category, page: page + direction };
	}

	if (action === "hback") {
		const category = parts[0] || null;
		const page = Number.parseInt(parts[1] ?? "0", 10) || 0;
		return { kind: "overview", category, page };
	}

	return null;
}

async function handleUnauthorized(interaction: MessageComponentInteraction) {
	await interaction.reply({
		components: [errorContainer("Not Authorized", "Only the command author can use this menu.")],
		flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
	});
}

async function runHelpSession(ctx: CommandContext, initialView: HelpView) {
	if (initialView.kind === "not_found") {
		await ctx.reply({
			components: [renderView(ctx.client, initialView)],
			flags: MessageFlags.IsComponentsV2,
		});
		return;
	}

	let view: HelpView = initialView;

	const message = await ctx.reply({
		components: [renderView(ctx.client, view)],
		flags: MessageFlags.IsComponentsV2,
	});

	const collector = message.createMessageComponentCollector({ time: COLLECTOR_TIME });

	collector.on("collect", async (interaction) => {
		if (interaction.user.id !== ctx.member.id) {
			await handleUnauthorized(interaction);
			return;
		}

		try {
			const next = resolveNextView(ctx.client, interaction);
			if (!next) return;

			view = next;
			await interaction.update({ components: [renderView(ctx.client, view)] });
		} catch (error) {
			logger.error("HelpCommand", "Interaction error", error as Error);
			if (!interaction.replied && !interaction.deferred) {
				await interaction
					.reply({
						components: [errorContainer("Error", "Something went wrong. Please try again.")],
						flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
					})
					.catch(() => undefined);
			}
		}
	});

	collector.on("end", async () => {
		await message.edit({ components: [renderView(ctx.client, view, true)] }).catch(() => undefined);
	});
}

async function runSearchSession(ctx: CommandContext, query: string) {
	const direct = findCommandByQuery(ctx.client, query);
	if (direct) {
		await runHelpSession(ctx, {
			kind: "details",
			command: direct,
			category: findCategoryOf(ctx.client, direct),
			page: 0,
		});
		return;
	}

	const results = searchCommands(ctx.client, query);

	if (results.length === 0) {
		await runHelpSession(ctx, { kind: "not_found", query });
		return;
	}

	const [firstResult] = results;
	if (results.length === 1 && firstResult) {
		await runHelpSession(ctx, {
			kind: "details",
			command: firstResult,
			category: findCategoryOf(ctx.client, firstResult),
			page: 0,
		});
		return;
	}

	await runHelpSession(ctx, { kind: "search", query, results });
}

export default defineCommand({
	name: "help",
	aliases: ["h", "commands", "cmds"],
	description: "View available commands and detailed usage guides",
	usage: "help [command]",
	category: "meta",
	examples: ["help", "help queue", "help how to clear queue"],
	enabledSlash: true,
	slashData: {
		name: "help",
		description: "View available commands and detailed usage guides",
		options: [
			{
				type: ApplicationCommandOptionType.String,
				name: "command",
				description: "Get detailed information about a specific command",
				required: false,
				autocomplete: true,
			},
		],
	},
	middleware: [Middleware.Cooldown(30)],
	async execute(ctx) {
		const query = ctx.isSlash() ? ctx.options.getString("command") : ctx.args.join(" ");
		const trimmed = query?.trim();

		if (trimmed) {
			await runSearchSession(ctx, trimmed);
			return;
		}

		const categories = visibleCategories(ctx.client);
		const firstCategory = Array.from(categories.keys()).sort()[0] ?? null;
		await runHelpSession(ctx, { kind: "overview", category: firstCategory, page: 0 });
	},
	async autocomplete(interaction: AutocompleteInteraction, client: BotClient) {
		try {
			const focused = interaction.options.getFocused().toLowerCase();
			const results = visibleCommands(client)
				.filter((command) => commandDisplayName(command.name).toLowerCase().includes(focused))
				.slice(0, 25)
				.map((command) => ({
					name: commandDisplayName(command.name),
					value: commandKey(command.name),
				}));

			await interaction.respond(results);
		} catch (error) {
			logger.error("HelpCommand", "Autocomplete error", error as Error);
		}
	},
});
