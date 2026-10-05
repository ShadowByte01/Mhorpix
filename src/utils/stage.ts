import { type Guild, Routes } from "discord.js";
import type { BotClient } from "../core/BotClient.js";
import { logger } from "./logger.js";
import { canBotBecomeSpeaker, isStageChannel } from "./permissions.js";

export interface StageResult {
	ok: boolean;
	reason?: string;
}

export async function unsuppressIfStage(
	guild: Guild,
	voiceChannelId: string,
	client: BotClient,
): Promise<StageResult> {
	const channel = guild.channels.cache.get(voiceChannelId);
	if (!channel?.isVoiceBased() || !isStageChannel(channel)) {
		logger.debug("Stage", `Not a stage channel: ${channel?.name ?? "unknown"}`);
		return { ok: true };
	}

	const me = guild.members.me;
	if (!me) return { ok: false, reason: "Bot member not cached." };

	if (me.voice.channelId === voiceChannelId && me.voice.suppress === false) {
		logger.debug("Stage", `Already speaking in ${channel?.name ?? "unknown"}`);
		return { ok: true };
	}

	if (!canBotBecomeSpeaker(channel)) {
		logger.debug("Stage", `Bot cannot become speaker: ${channel?.name ?? "unknown"}`);
		return {
			ok: false,
			reason:
				'I joined, but I cannot become a Stage speaker — I need the "Mute Members" permission in this Stage channel.',
		};
	}

	try {
		await client.rest.patch(Routes.guildVoiceState(guild.id, "@me"), {
			body: {
				channel_id: voiceChannelId,
				suppress: false,
			},
		});
		logger.debug("Stage", `Successfully unsuppressed in ${channel?.name ?? "unknown"}`);
		return { ok: true };
	} catch (err) {
		logger.warn("Stage", `Failed to unsuppress in ${guild.id}: ${(err as Error).message}`);
		return { ok: false, reason: "I joined the Stage, but failed to become a speaker. Try again." };
	}
}
