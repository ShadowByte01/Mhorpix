import type {
	ChatInputCommandInteraction,
	Guild,
	GuildMember,
	GuildTextBasedChannel,
	Message,
	User,
} from "discord.js";
import type { BotClient } from "../../core/BotClient.js";
import { BaseCommandContext } from "./BaseCommandContext.js";
import type { PrefixCommandContext } from "./PrefixCommandContext.js";
import { toInteractionEditReplyOptions, toInteractionReplyOptions } from "./payload.js";
import type { ContextReplyOptions } from "./types.js";

export class SlashCommandContext extends BaseCommandContext {
	public readonly interaction: ChatInputCommandInteraction<"cached">;

	constructor(client: BotClient, interaction: ChatInputCommandInteraction<"cached">) {
		super(client);
		this.interaction = interaction;
	}

	get user(): User {
		return this.interaction.user;
	}

	get member(): GuildMember {
		return this.interaction.member;
	}

	get guild(): Guild {
		return this.interaction.guild;
	}

	get channel(): GuildTextBasedChannel {
		return this.interaction.channel as GuildTextBasedChannel;
	}

	get options() {
		return this.interaction.options;
	}
	get deferred(): boolean {
		return this.interaction.deferred;
	}

	get replied(): boolean {
		return this.interaction.replied;
	}

	async reply(options: ContextReplyOptions): Promise<Message> {
		if (this.interaction.deferred || this.interaction.replied) {
			return this.interaction.editReply(toInteractionEditReplyOptions(options));
		}
		await this.interaction.reply(toInteractionReplyOptions(options));
		return this.interaction.fetchReply();
	}
	async editReply(options: ContextReplyOptions): Promise<Message> {
		return this.interaction.editReply(toInteractionEditReplyOptions(options));
	}

	async deferReply(): Promise<void> {
		if (this.interaction.deferred || this.interaction.replied) return;
		await this.interaction.deferReply();
	}

	async followUp(options: ContextReplyOptions): Promise<Message> {
		return this.interaction.followUp(toInteractionReplyOptions(options));
	}

	async deleteReply(): Promise<void> {
		await this.interaction.deleteReply();
	}

	async sendTyping(): Promise<void> {
		if (!this.deferred && !this.replied) {
			await this.deferReply();
		}
	}

	isSlash(): this is SlashCommandContext {
		return true;
	}

	isPrefix(): this is PrefixCommandContext {
		return false;
	}
}
