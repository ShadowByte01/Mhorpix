import type { ClientEvents } from "discord.js";
import type { BotClient } from "../core/BotClient.js";

export interface DiscordEvent<K extends keyof ClientEvents = keyof ClientEvents> {
	name: K;
	once?: boolean;
	execute: (client: BotClient, ...args: ClientEvents[K]) => Promise<void> | void;
}

export function defineEvent<K extends keyof ClientEvents>(event: DiscordEvent<K>): DiscordEvent<K> {
	return event;
}
