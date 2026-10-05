import type { Guild, GuildMember, GuildTextBasedChannel, Message, User } from "discord.js";
import type { BotClient } from "../../core/BotClient.js";
import type { PrefixCommandContext } from "./PrefixCommandContext.js";
import type { SlashCommandContext } from "./SlashCommandContext.js";
import type { ContextReplyOptions } from "./types.js";

export abstract class BaseCommandContext {
	public readonly client: BotClient;

	protected constructor(client: BotClient) {
		this.client = client;
	}

	abstract get user(): User;
	abstract get member(): GuildMember;
	abstract get guild(): Guild;
	abstract get channel(): GuildTextBasedChannel;
	abstract get deferred(): boolean;
	abstract get replied(): boolean;

	abstract reply(options: ContextReplyOptions): Promise<Message>;
	abstract editReply(options: ContextReplyOptions): Promise<Message>;
	abstract deferReply(): Promise<void>;
	abstract followUp(options: ContextReplyOptions): Promise<Message>;
	abstract deleteReply(): Promise<void>;
	abstract sendTyping(): Promise<void>;

	abstract isSlash(): this is SlashCommandContext;
	abstract isPrefix(): this is PrefixCommandContext;
}
