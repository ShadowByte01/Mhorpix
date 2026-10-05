import type {
	InteractionEditReplyOptions,
	InteractionReplyOptions,
	MessageCreateOptions,
	MessageEditOptions,
} from "discord.js";
import { MessageFlags } from "discord.js";
import type { ContextReplyOptions } from "./types.js";

function buildFlags(options: ContextReplyOptions): number | undefined {
	let flags = Number(options.flags ?? 0);
	if (options.components?.length) {
		flags |= MessageFlags.IsComponentsV2;
	}
	return flags || undefined;
}

export function toMessageCreateOptions(options: ContextReplyOptions): MessageCreateOptions {
	return {
		content: options.content,
		embeds: options.embeds,
		components: options.components,
		allowedMentions: options.allowedMentions,
		flags: buildFlags(options),
	};
}

export function toMessageEditOptions(options: ContextReplyOptions): MessageEditOptions {
	return {
		content: options.content ?? null,
		embeds: options.embeds ?? [],
		components: options.components ?? [],
		allowedMentions: options.allowedMentions,
		flags: buildFlags(options),
	};
}

export function toInteractionReplyOptions(options: ContextReplyOptions): InteractionReplyOptions {
	return {
		content: options.content,
		embeds: options.embeds,
		components: options.components,
		allowedMentions: options.allowedMentions,
		flags: buildFlags(options),
	};
}

export function toInteractionEditReplyOptions(
	options: ContextReplyOptions,
): InteractionEditReplyOptions {
	return {
		content: options.content,
		embeds: options.embeds,
		components: options.components,
		allowedMentions: options.allowedMentions,
		flags: buildFlags(options),
	};
}
