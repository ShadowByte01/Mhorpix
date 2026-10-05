import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ClientEvents } from "discord.js";
import type { DiscordEvent } from "../types/index.js";
import { logger } from "../utils/logger.js";
import type { BotClient } from "./BotClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class EventLoader {
	private readonly client: BotClient;
	private loadedCount = 0;
	constructor(client: BotClient) {
		this.client = client;
	}
	async load(dir: string = path.join(__dirname, "../events/discord")): Promise<void> {
		await this.loadDirectory(dir);
		logger.success("EventLoader", `Loaded ${this.loadedCount} events`);
	}

	private async loadDirectory(dir: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true });

		await Promise.all(
			entries.map(async (entry) => {
				const fullPath = path.join(dir, entry.name);

				if (entry.isDirectory()) {
					await this.loadDirectory(fullPath);
				} else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
					await this.loadFile(fullPath);
				}
			}),
		);
	}

	private async loadFile(fullPath: string): Promise<void> {
		try {
			const imported = (await import(pathToFileURL(fullPath).href)) as {
				default?: DiscordEvent;
			};
			const event = imported.default;

			if (!event) {
				logger.warn("EventLoader", `${path.basename(fullPath)} has no default export`);
				return;
			}

			this.register(event);
		} catch (error) {
			logger.error("EventLoader", `Failed to load event file: ${fullPath}`, error as Error);
		}
	}

	private register<K extends keyof ClientEvents>(event: DiscordEvent<K>): void {
		const listener = (...args: ClientEvents[K]) => {
			Promise.resolve(event.execute(this.client, ...args)).catch((error: unknown) => {
				logger.error("Event", `Error handling event "${event.name}"`, error as Error);
			});
		};

		if (event.once) {
			this.client.once(event.name, listener);
		} else {
			this.client.on(event.name, listener);
		}

		this.loadedCount += 1;
	}
}
