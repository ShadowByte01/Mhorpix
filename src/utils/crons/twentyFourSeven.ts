import { ChannelType } from "discord.js";
import { disableTwentyFourSeven, ensureGuild } from "../../db/stores/guild.js";
import { logger } from "../logger.js";
import { sleep } from "../sleep.js";
import { MINUTES, registerCron } from "./index.js";

const RATE_LIMIT_DELAY_MS = 5_000;

registerCron({
	name: "twentyFourSeven-healthcheck",
	intervalMs: 15 * MINUTES,
	async run(client) {
		for (const [guildId] of client.guilds.cache) {
			// biome-ignore lint/performance/noAwaitInLoops: required
			const guild = await ensureGuild(guildId).catch(() => null);
			if (!guild?.twentyFourSeven) continue;

			const {
				twentyFourSevenTextChannel: textChannelId,
				twentyFourSevenVoiceChannel: voiceChannelId,
			} = guild;

			if (!textChannelId || !voiceChannelId) {
				logger.warn("Cron", `[${guildId}] 24/7 enabled but missing channel id(s), disabling`);
				await disableTwentyFourSeven(guildId).catch(() => undefined);
				continue;
			}

			if (client.music.hasPlayer(guildId)) continue;

			try {
				const discordGuild = await client.guilds.fetch(guildId);
				const voiceChannel = await discordGuild.channels.fetch(voiceChannelId).catch(() => null);
				const textChannel = await discordGuild.channels.fetch(textChannelId).catch(() => null);

				if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
					throw new Error("Voice channel no longer exists");
				}
				if (!textChannel?.isTextBased()) {
					throw new Error("Text channel no longer exists");
				}

				await client.music.createPlayer({
					guildId,
					voiceChannelId: voiceChannel.id,
					textChannelId: textChannel.id,
				});

				logger.success("Music", `[${guildId}] Restored 24/7 player`);
			} catch (err) {
				logger.error(
					"Music",
					`[${guildId}] Failed to restore 24/7 player, disabling 24/7`,
					err as Error,
				);
				await disableTwentyFourSeven(guildId).catch(() => undefined);
			}

			await sleep(RATE_LIMIT_DELAY_MS);
		}
	},
});
