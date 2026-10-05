import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ManagerEvents, MusicEvent } from "../structures/music/index.js";
import { logger } from "../utils/logger.js";
import type { BotClient } from "./BotClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class MusicEventLoader {
	private readonly _client: BotClient;
	private _loadedCount = 0;

	public constructor(client: BotClient) {
		this._client = client;
	}

	public async load(dir: string = path.join(__dirname, "../events/music")): Promise<void> {
		this._loadedCount = 0;
		await this._loadDirectory(dir);
		logger.success("MusicEventLoader", `Loaded ${this._loadedCount} music events`);
	}

	private async _loadDirectory(dir: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true });

		await Promise.all(
			entries.map(async (entry) => {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					await this._loadDirectory(fullPath);
				} else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
					await this._loadFile(fullPath);
				}
			}),
		);
	}

	private async _loadFile(fullPath: string): Promise<void> {
		try {
			const imported = (await import(pathToFileURL(fullPath).href)) as {
				default?: MusicEvent;
			};
			const event = imported.default;

			if (!event) {
				logger.warn("MusicEventLoader", `${path.basename(fullPath)} has no default export`);
				return;
			}

			this._register(event);
		} catch (error) {
			logger.error("MusicEventLoader", `Failed to load: ${fullPath}`, error as Error);
		}
	}

	private _register<K extends keyof ManagerEvents>(event: MusicEvent<K>): void {
		const listener = (...args: ManagerEvents[K]) => {
			Promise.resolve(event.execute(this._client, ...args)).catch((error: unknown) => {
				logger.error("MusicEvent", `Error in music event "${event.name}"`, error as Error);
			});
		};

		if (event.once) {
			this._client.music.once(event.name, listener);
		} else {
			this._client.music.on(event.name, listener);
		}

		this._loadedCount += 1;
	}
}
