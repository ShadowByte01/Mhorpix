import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelSelectMenuBuilder,
	CheckboxBuilder,
	CheckboxGroupBuilder,
	ContainerBuilder,
	FileBuilder,
	FileUploadBuilder,
	LabelBuilder,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MentionableSelectMenuBuilder,
	type MessageActionRowComponentBuilder,
	ModalBuilder,
	RadioGroupBuilder,
	RoleSelectMenuBuilder,
	SectionBuilder,
	type SelectMenuComponentOptionData,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
	ThumbnailBuilder,
	UserSelectMenuBuilder,
} from "discord.js";
import { config } from "../config/config.js";

export function errorContainer(title: string, description: string): ContainerBuilder {
	return new ContainerBuilder()
		.setAccentColor(config.colors.error)
		.addTextDisplayComponents(TextDisplay(`### ${title}`))
		.addSeparatorComponents(Separator())
		.addTextDisplayComponents(TextDisplay(`-# ${description}`));
}

export function successContainer(): ContainerBuilder {
	return new ContainerBuilder().setAccentColor(config.colors.success);
}
export function defContainer(): ContainerBuilder {
	return new ContainerBuilder().setAccentColor(config.colors.default);
}
export function baseContainer(): ContainerBuilder {
	return new ContainerBuilder();
}
export function baseSection(): SectionBuilder {
	return new SectionBuilder();
}

export function TextDisplay(content: string): TextDisplayBuilder {
	return new TextDisplayBuilder().setContent(content);
}

export function Thumbnail(description: string, url: string): ThumbnailBuilder {
	return new ThumbnailBuilder().setDescription(description).setURL(url);
}

export function Separator(
	divider = true,
	size: SeparatorSpacingSize = SeparatorSpacingSize.Small,
): SeparatorBuilder {
	return new SeparatorBuilder().setDivider(divider).setSpacing(size);
}

export function MediaGalleryItem(
	url: string,
	description?: string,
	spoiler = false,
): MediaGalleryItemBuilder {
	const item = new MediaGalleryItemBuilder().setURL(url).setSpoiler(spoiler);
	if (description) item.setDescription(description);
	return item;
}

export function MediaGallery(...items: MediaGalleryItemBuilder[]): MediaGalleryBuilder {
	return new MediaGalleryBuilder().addItems(...items);
}

export function FileDisplay(url: string, spoiler = false): FileBuilder {
	return new FileBuilder().setURL(url).setSpoiler(spoiler);
}

export function baseButton(): ButtonBuilder {
	return new ButtonBuilder();
}

export function linkButton(label: string, url: string): ButtonBuilder {
	return new ButtonBuilder().setLabel(label).setURL(url).setStyle(ButtonStyle.Link);
}
export function emojiLinkButton(url: string, emoji: string): ButtonBuilder {
	const match = emoji.match(/<:\w+:(\d+)>/);
	return new ButtonBuilder()
		.setURL(url)
		.setStyle(ButtonStyle.Link)
		.setEmoji(match ? { id: match[1] } : emoji);
}

export function primaryButton(label: string, customId: string, disabled = false): ButtonBuilder {
	return new ButtonBuilder()
		.setLabel(label)
		.setStyle(ButtonStyle.Primary)
		.setCustomId(customId)
		.setDisabled(disabled);
}
export function emojiPrimaryButton(
	customId: string,
	emoji: string,
	disabled = false,
): ButtonBuilder {
	const match = emoji.match(/<:\w+:(\d+)>/);
	return new ButtonBuilder()
		.setStyle(ButtonStyle.Primary)
		.setCustomId(customId)
		.setDisabled(disabled)
		.setEmoji(match ? { id: match[1] } : emoji);
}

export function secondaryButton(label: string, customId: string, disabled = false): ButtonBuilder {
	return new ButtonBuilder()
		.setStyle(ButtonStyle.Secondary)
		.setLabel(label)
		.setCustomId(customId)
		.setDisabled(disabled);
}

export function emojiSecondaryButton(
	customId: string,
	emoji: string,
	disabled = false,
): ButtonBuilder {
	const match = emoji.match(/<:\w+:(\d+)>/);
	return new ButtonBuilder()
		.setStyle(ButtonStyle.Secondary)
		.setCustomId(customId)
		.setDisabled(disabled)
		.setEmoji(match ? { id: match[1] } : emoji);
}
export function successButton(label: string, customId: string, disabled = false): ButtonBuilder {
	return new ButtonBuilder()
		.setLabel(label)
		.setStyle(ButtonStyle.Success)
		.setCustomId(customId)
		.setDisabled(disabled);
}

export function emojiSuccessButton(
	customId: string,
	emoji: string,
	disabled = false,
): ButtonBuilder {
	const match = emoji.match(/<:\w+:(\d+)>/);
	return new ButtonBuilder()
		.setStyle(ButtonStyle.Success)
		.setCustomId(customId)
		.setDisabled(disabled)
		.setEmoji(match ? { id: match[1] } : emoji);
}

export function dangerButton(label: string, customId: string, disabled = false): ButtonBuilder {
	return new ButtonBuilder()
		.setLabel(label)
		.setStyle(ButtonStyle.Danger)
		.setCustomId(customId)
		.setDisabled(disabled);
}

export function emojiDangerButton(
	customId: string,
	emoji: string,
	disabled = false,
): ButtonBuilder {
	const match = emoji.match(/<:\w+:(\d+)>/);
	return new ButtonBuilder()
		.setStyle(ButtonStyle.Danger)
		.setCustomId(customId)
		.setDisabled(disabled)
		.setEmoji(match ? { id: match[1] } : emoji);
}

export function ActionRow(): ActionRowBuilder<MessageActionRowComponentBuilder> {
	return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

export function SelectMenuOption(
	label: string,
	value: string,
	description?: string,
	defaultOption = false,
): StringSelectMenuOptionBuilder {
	const option = new StringSelectMenuOptionBuilder()
		.setLabel(label)
		.setValue(value)
		.setDefault(defaultOption);
	if (description) option.setDescription(description);
	return option;
}

export function SelectMenu(
	placeholder: string,
	options: SelectMenuComponentOptionData[],
	customId: string,
	min: number,
	max: number,
	disabled = false,
): StringSelectMenuBuilder {
	return new StringSelectMenuBuilder()
		.setPlaceholder(placeholder)
		.addOptions(options)
		.setDisabled(disabled)
		.setCustomId(customId)
		.setMinValues(min)
		.setMaxValues(max);
}

// For use inside modals: modal selects don't allow a `disabled` field, and
// support their own `required` flag instead — so this is a distinct builder,
// not just SelectMenu() with disabled omitted.
export function ModalSelectMenu(
	placeholder: string,
	options: SelectMenuComponentOptionData[],
	customId: string,
	min: number,
	max: number,
	required = true,
): StringSelectMenuBuilder {
	return new StringSelectMenuBuilder()
		.setPlaceholder(placeholder)
		.addOptions(options)
		.setCustomId(customId)
		.setMinValues(min)
		.setMaxValues(max)
		.setRequired(required);
}

export function UserSelectMenu(
	placeholder: string,
	customId: string,
	min: number,
	max: number,
	defaultUsers: string[] = [],
	disabled = false,
): UserSelectMenuBuilder {
	return new UserSelectMenuBuilder()
		.setDisabled(disabled)
		.setCustomId(customId)
		.setPlaceholder(placeholder)
		.setDefaultUsers(defaultUsers)
		.setMaxValues(max)
		.setMinValues(min);
}

export function RoleSelectMenu(
	placeholder: string,
	customId: string,
	min: number,
	max: number,
	defaultRoles: string[] = [],
	disabled = false,
): RoleSelectMenuBuilder {
	return new RoleSelectMenuBuilder()
		.setDisabled(disabled)
		.setCustomId(customId)
		.setPlaceholder(placeholder)
		.setDefaultRoles(defaultRoles)
		.setMaxValues(max)
		.setMinValues(min);
}

export function ChannelSelectMenu(
	placeholder: string,
	customId: string,
	min: number,
	max: number,
	defaultChannels: string[] = [],
	disabled = false,
): ChannelSelectMenuBuilder {
	return new ChannelSelectMenuBuilder()
		.setDisabled(disabled)
		.setCustomId(customId)
		.setPlaceholder(placeholder)
		.setDefaultChannels(defaultChannels)
		.setMaxValues(max)
		.setMinValues(min);
}

export function MentionableSelectMenu(
	placeholder: string,
	customId: string,
	min: number,
	max: number,
	disabled = false,
): MentionableSelectMenuBuilder {
	return new MentionableSelectMenuBuilder()
		.setDisabled(disabled)
		.setCustomId(customId)
		.setPlaceholder(placeholder)
		.setMaxValues(max)
		.setMinValues(min);
}

export function FileUpload(customId: string, min = 1, max = 1, required = true): FileUploadBuilder {
	return new FileUploadBuilder()
		.setCustomId(customId)
		.setMinValues(min)
		.setMaxValues(max)
		.setRequired(required);
}

export interface GroupOptionData {
	label: string;
	value: string;
	description?: string;
	default?: boolean;
}

export function RadioGroup(
	customId: string,
	options: GroupOptionData[],
	required = true,
): RadioGroupBuilder {
	return new RadioGroupBuilder().setCustomId(customId).addOptions(options).setRequired(required);
}

export function CheckboxGroup(
	customId: string,
	options: GroupOptionData[],
	min = 1,
	max = options.length,
	required = true,
): CheckboxGroupBuilder {
	return new CheckboxGroupBuilder()
		.setCustomId(customId)
		.addOptions(options)
		.setMinValues(min)
		.setMaxValues(max)
		.setRequired(required);
}

export function Checkbox(customId: string, defaultChecked = false): CheckboxBuilder {
	return new CheckboxBuilder().setCustomId(customId).setDefault(defaultChecked);
}

export function Modal(customId: string, title: string): ModalBuilder {
	return new ModalBuilder().setCustomId(customId).setTitle(title);
}

export function TextInput(
	customId: string,
	style: TextInputStyle = TextInputStyle.Short,
	required = false,
): TextInputBuilder {
	return new TextInputBuilder().setCustomId(customId).setStyle(style).setRequired(required);
}

type LabelableComponent =
	| TextInputBuilder
	| StringSelectMenuBuilder
	| UserSelectMenuBuilder
	| RoleSelectMenuBuilder
	| ChannelSelectMenuBuilder
	| MentionableSelectMenuBuilder
	| FileUploadBuilder
	| RadioGroupBuilder
	| CheckboxGroupBuilder
	| CheckboxBuilder;

export function Label(
	label: string,
	component: LabelableComponent,
	description?: string,
): LabelBuilder {
	const builder = new LabelBuilder().setLabel(label);
	if (description) builder.setDescription(description);

	if (component instanceof TextInputBuilder) {
		builder.setTextInputComponent(component);
	} else if (component instanceof StringSelectMenuBuilder) {
		builder.setStringSelectMenuComponent(component);
	} else if (component instanceof UserSelectMenuBuilder) {
		builder.setUserSelectMenuComponent(component);
	} else if (component instanceof RoleSelectMenuBuilder) {
		builder.setRoleSelectMenuComponent(component);
	} else if (component instanceof ChannelSelectMenuBuilder) {
		builder.setChannelSelectMenuComponent(component);
	} else if (component instanceof MentionableSelectMenuBuilder) {
		builder.setMentionableSelectMenuComponent(component);
	} else if (component instanceof FileUploadBuilder) {
		builder.setFileUploadComponent(component);
	} else if (component instanceof RadioGroupBuilder) {
		builder.setRadioGroupComponent(component);
	} else if (component instanceof CheckboxGroupBuilder) {
		builder.setCheckboxGroupComponent(component);
	} else if (component instanceof CheckboxBuilder) {
		builder.setCheckboxComponent(component);
	}

	return builder;
}
