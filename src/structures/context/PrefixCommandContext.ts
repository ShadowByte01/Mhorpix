import type { Guild, GuildMember, GuildTextBasedChannel, Message, User } from "discord.js";
import type { BotClient } from "../../core/BotClient.js";
import { BaseCommandContext } from "./BaseCommandContext.js";
import { toMessageCreateOptions, toMessageEditOptions } from "./payload.js";
import type { SlashCommandContext } from "./SlashCommandContext.js";
import type { ContextReplyOptions } from "./types.js";

export class PrefixCommandContext extends BaseCommandContext {
	public readonly message: Message<true>;
	public readonly args: string[];

	private replyMessage: Message | null = null;
	private isDeferred = false;

	constructor(client: BotClient, message: Message<true>, args: string[]) {
		super(client);
		this.message = message;
		this.args = args;
	}

	get user(): User {
		return this.message.author;
	}

	get member(): GuildMember {
		return this.message.member as GuildMember;
	}

	get guild(): Guild {
		return this.message.guild;
	}

	get channel(): GuildTextBasedChannel {
		return this.message.channel as GuildTextBasedChannel;
	}

	get deferred(): boolean {
		return this.isDeferred;
	}

	get replied(): boolean {
		return this.replyMessage !== null;
	}

	async reply(options: ContextReplyOptions): Promise<Message> {
		this.replyMessage = await this.message.reply(toMessageCreateOptions(options));
		return this.replyMessage;
	}

	async editReply(options: ContextReplyOptions): Promise<Message> {
		if (!this.replyMessage) {
			throw new Error("Cannot edit reply: no initial reply has been sent yet.");
		}
		return this.replyMessage.edit(toMessageEditOptions(options));
	}

	async deferReply(): Promise<void> {
		this.isDeferred = true;
		await this.message.channel.sendTyping();
	}

	async followUp(options: ContextReplyOptions): Promise<Message> {
		return this.message.channel.send(toMessageCreateOptions(options));
	}

	async deleteReply(): Promise<void> {
		await this.replyMessage?.delete();
		this.replyMessage = null;
	}

	async sendTyping(): Promise<void> {
		await this.message.channel.sendTyping();
	}

	isSlash(): this is SlashCommandContext {
		return false;
	}

	isPrefix(): this is PrefixCommandContext {
		return true;
	}
}
