import type { AutocompleteInteraction, PermissionsBitField } from "discord.js";
import type { APIApplicationCommandBasicOption } from "discord-api-types/v10";
import type { BotClient } from "../core/BotClient.js";
import type { CommandContext } from "../structures/context/index.js";
import type { MiddlewareFn } from "./middleware.js";

export type CommandName = string | [string, string] | [string, string, string];

export interface SlashCommandData {
	name: CommandName;
	description: string;
	options?: APIApplicationCommandBasicOption[];
	defaultMemberPermissions?: PermissionsBitField | bigint | number | null;
}

export interface Command {
	name: CommandName;
	aliases?: string[];
	description?: string;
	usage?: string;
	slashUsage?: string;
	category?: string;
	examples?: string[];
	enabledSlash?: boolean;
	slashData?: SlashCommandData;
	middleware?: MiddlewareFn[];
	execute: (ctx: CommandContext) => Promise<unknown> | unknown;
	autocomplete?: (
		interaction: AutocompleteInteraction,
		client: BotClient,
	) => Promise<unknown> | unknown;
}

export function defineCommand<const T extends Command>(command: T): T {
	return command;
}
