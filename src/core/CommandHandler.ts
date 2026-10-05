import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REST, Routes } from "discord.js";
import {
	type APIApplicationCommandBasicOption,
	type APIApplicationCommandOption,
	type APIApplicationCommandSubcommandGroupOption,
	ApplicationCommandOptionType,
	type RESTPostAPIApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import { config } from "../config/config.js";
import type { Command, CommandName } from "../types/index.js";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function nameKey(name: CommandName): string {
	return Array.isArray(name) ? name.join(":").toLowerCase() : name.toLowerCase();
}

export interface ResolvedPrefixCommand {
	command: Command;
	args: string[];
}

interface SlashCommandBuilder {
	name: string;
	description: string;
	options: APIApplicationCommandOption[];
	default_member_permissions?: string | null;
}

export class CommandHandler {
	public readonly commands = new Map<string, Command>();
	public readonly aliases = new Map<string, string>();
	public readonly arrayCommands = new Map<string, Command[]>();
	public readonly slashCommandFiles = new Map<string, Command>();
	public readonly slashCommands = new Map<string, SlashCommandBuilder>();
	public readonly categories = new Map<string, Command[]>();

	async load(dir: string = path.join(__dirname, "../commands")): Promise<void> {
		this.commands.clear();
		this.aliases.clear();
		this.arrayCommands.clear();
		this.slashCommandFiles.clear();
		this.slashCommands.clear();
		this.categories.clear();

		await this.loadDirectory(dir);
		this.buildSlashCommandTree();

		logger.success(
			"CommandHandler",
			`Loaded ${this.commands.size} prefix and ${this.slashCommandFiles.size} slash commands`,
		);
	}

	private async loadDirectory(dir: string, category = "general"): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true });

		await Promise.all(
			entries.map(async (entry) => {
				const fullPath = path.join(dir, entry.name);

				if (entry.isDirectory()) {
					await this.loadDirectory(fullPath, entry.name);
				} else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
					await this.loadFile(fullPath, category);
				}
			}),
		);
	}

	private async loadFile(fullPath: string, category: string): Promise<void> {
		try {
			const imported = (await import(pathToFileURL(fullPath).href)) as { default?: Command };
			const command = imported.default;

			if (!command) {
				logger.warn("CommandHandler", `${path.basename(fullPath)} has no default export`);
				return;
			}

			command.category ??= category;
			this.registerCommand(command);
		} catch (error) {
			logger.error("CommandHandler", `Failed to load command file: ${fullPath}`, error as Error);
		}
	}

	private registerCommand(command: Command): void {
		const key = nameKey(command.name);
		this.commands.set(key, command);

		if (Array.isArray(command.name) && command.name.length > 1) {
			const group = command.name[0].toLowerCase();
			const bucket = this.arrayCommands.get(group) ?? [];
			bucket.push(command);
			this.arrayCommands.set(group, bucket);
		}

		for (const alias of command.aliases ?? []) {
			this.aliases.set(alias.toLowerCase(), key);
		}

		if (command.enabledSlash && command.slashData) {
			this.slashCommandFiles.set(nameKey(command.slashData.name), command);
		}

		const category = command.category ?? "general";
		const bucket = this.categories.get(category) ?? [];
		bucket.push(command);
		this.categories.set(category, bucket);
	}

	private buildSlashCommandTree(): void {
		for (const command of this.slashCommandFiles.values()) {
			const slashData = command.slashData;
			if (!slashData) continue;

			const { name, description, options, defaultMemberPermissions } = slashData;
			const defaultMemberPermissionsString =
				defaultMemberPermissions != null ? String(defaultMemberPermissions) : undefined;

			if (typeof name === "string") {
				this.slashCommands.set(name, {
					name,
					description,
					options: options ?? [],
					default_member_permissions: defaultMemberPermissionsString,
				});
				continue;
			}

			this.registerArraySlashCommand(name, description, options ?? []);
		}
	}

	private registerArraySlashCommand(
		name: Exclude<CommandName, string>,
		description: string,
		options: APIApplicationCommandBasicOption[],
	): void {
		const [root, second] = name;
		let rootCommand = this.slashCommands.get(root);

		if (!rootCommand) {
			rootCommand = { name: root, description: `${root} commands`, options: [] };
			this.slashCommands.set(root, rootCommand);
		}

		if (name.length === 2) {
			rootCommand.options.push({
				type: ApplicationCommandOptionType.Subcommand,
				name: second,
				description,
				options,
			});
			return;
		}

		const third = name[2];

		let group = rootCommand.options.find(
			(option): option is APIApplicationCommandSubcommandGroupOption =>
				option.type === ApplicationCommandOptionType.SubcommandGroup && option.name === second,
		);

		if (!group) {
			group = {
				type: ApplicationCommandOptionType.SubcommandGroup,
				name: second,
				description: `${second} commands`,
				options: [],
			};
			rootCommand.options.push(group);
		}

		group.options ??= [];
		group.options.push({
			type: ApplicationCommandOptionType.Subcommand,
			name: third,
			description,
			options,
		});
	}

	async registerSlashCommands(): Promise<void> {
		const body = Array.from(
			this.slashCommands.values(),
		) as RESTPostAPIApplicationCommandsJSONBody[];

		// Compute a deterministic hash of the current command payload
		// Commands are sorted by name so object insertion order doesn't affect the hash
		const hashFile = path.join(process.cwd(), "commands.hash");
		const currentHash = this._hashCommands(body);

		let savedHash: string | null = null;
		try {
			savedHash = (await readFile(hashFile, "utf8")).trim();
		} catch {
			// file doesn't exist yet — first run
		}

		if (savedHash === currentHash) {
			logger.success(
				"CommandHandler",
				`Slash commands unchanged (${body.length} commands) — skipping registration`,
			);
			return;
		}

		const rest = new REST({ version: "10" }).setToken(config.token);
		await rest.put(Routes.applicationCommands(config.clientId), { body });
		logger.success("CommandHandler", `Registered ${body.length} slash commands`);

		try {
			await writeFile(hashFile, currentHash, "utf8");
		} catch (err) {
			logger.warn("CommandHandler", `Failed to write command hash file: ${(err as Error).message}`);
		}
	}

	private _hashCommands(body: RESTPostAPIApplicationCommandsJSONBody[]): string {
		const sorted = [...body]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((cmd) => JSON.stringify(cmd, Object.keys(cmd).sort()));
		return createHash("sha256").update(sorted.join("\n")).digest("hex");
	}

	get(nameOrAlias: string): Command | undefined {
		const key = nameOrAlias.toLowerCase();
		const direct = this.commands.get(key);
		if (direct) return direct;

		const aliasedKey = this.aliases.get(key);
		return aliasedKey ? this.commands.get(aliasedKey) : undefined;
	}

	resolvePrefixCommand(args: string[]): ResolvedPrefixCommand | undefined {
		const first = args[0]?.toLowerCase();
		if (!first) return undefined;

		const grouped = this.arrayCommands.get(first);
		if (grouped?.length) {
			const sorted = [...grouped].sort((a, b) => {
				const aLength = Array.isArray(a.name) ? a.name.length : 1;
				const bLength = Array.isArray(b.name) ? b.name.length : 1;
				return bLength - aLength;
			});

			for (const command of sorted) {
				const parts = (Array.isArray(command.name) ? command.name : [command.name]).map((part) =>
					part.toLowerCase(),
				);
				const matches = parts.every((part, index) => args[index]?.toLowerCase() === part);
				if (matches) {
					return { command, args: args.slice(parts.length) };
				}
			}
		}

		const command = this.get(first);
		if (!command) return undefined;

		return { command, args: args.slice(1) };
	}

	getSlashCommandFile(
		commandName: string,
		subCommandGroup?: string | null,
		subCommand?: string | null,
	): Command | undefined {
		if (subCommandGroup && subCommand) {
			const byGroup = this.slashCommandFiles.get(`${commandName}:${subCommandGroup}:${subCommand}`);
			if (byGroup) return byGroup;
		}

		if (subCommand) {
			const bySub = this.slashCommandFiles.get(`${commandName}:${subCommand}`);
			if (bySub) return bySub;
		}

		return this.slashCommandFiles.get(commandName);
	}
}
