import type {
	ActionRowBuilder,
	ContainerBuilder,
	EmbedBuilder,
	FileBuilder,
	MediaGalleryBuilder,
	MessageActionRowComponentBuilder,
	MessageFlagsResolvable,
	MessageMentionOptions,
	SectionBuilder,
	SeparatorBuilder,
	TextDisplayBuilder,
} from "discord.js";

type TopLevelComponentBuilder =
	| ActionRowBuilder<MessageActionRowComponentBuilder>
	| ContainerBuilder
	| TextDisplayBuilder
	| SeparatorBuilder
	| SectionBuilder
	| MediaGalleryBuilder
	| FileBuilder;

export interface ContextReplyOptions {
	content?: string;
	embeds?: EmbedBuilder[];
	components?: TopLevelComponentBuilder[];
	allowedMentions?: MessageMentionOptions;
	flags?: MessageFlagsResolvable;
}
