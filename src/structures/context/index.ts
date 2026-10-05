import type { PrefixCommandContext } from "./PrefixCommandContext.js";
import type { SlashCommandContext } from "./SlashCommandContext.js";

export type CommandContext = PrefixCommandContext | SlashCommandContext;

export { PrefixCommandContext } from "./PrefixCommandContext.js";
export { SlashCommandContext } from "./SlashCommandContext.js";
export type { ContextReplyOptions } from "./types.js";
