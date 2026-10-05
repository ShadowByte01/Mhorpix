import { addManyToHistory } from "../../db/stores/music.js";
import { executeAutoplay } from "../../structures/music/autoplay.js";
import { defineMusicEvent, savePlayerSnapshot } from "../../structures/music/index.js";
import { logger } from "../../utils/logger.js";
import { deleteNowPlaying, sendNowPlaying } from "../../utils/playerMessages.js";
import { unsuppressIfStage } from "../../utils/stage.js";
import { updatePlayerVcStatus } from "../../utils/voiceChannelStatus.js";

export default defineMusicEvent({
	name: "trackStart",
	async execute(client, player, track, snapshot) {
		logger.debug(
			"Music",
			`[${snapshot.guildId}] Track started: "${track.info.title}" by ${track.info.author}`,
		);
		await savePlayerSnapshot(player);

		const guild = client.guilds.cache.get(snapshot.guildId);
		if (guild && player.voiceChannelId) {
			await unsuppressIfStage(guild, player.voiceChannelId, client);
		}

		await deleteNowPlaying(player, client);
		await sendNowPlaying(player, track, client);

		// Update the voice channel status to show the current song.
		// This sets the text visible on the VC in the channel list.
		if (player.voiceChannelId) {
			await updatePlayerVcStatus(client, player.voiceChannelId, track, player.queue.size);
		}

		if (guild && player.voiceChannelId) {
			const voiceChannel = guild.channels.cache.get(player.voiceChannelId);
			if (voiceChannel?.isVoiceBased()) {
				const listenerIds = voiceChannel.members.filter((m) => !m.user.bot).map((m) => m.id);
				try {
					await addManyToHistory(listenerIds, track.encoded);
				} catch (err) {
					logger.error("Music:trackStart", `Failed to record history: ${(err as Error).message}`);
				}
			}
		}

		if (player.getAutoplay() && player.queue.size < 2) {
			try {
				await executeAutoplay(player, client.music, track);
				logger.debug("Autplay:trackStart", "Autoplay executed");
			} catch (err) {
				logger.error("Autoplay:trackStart", err instanceof Error ? err.message : String(err));
			}
		}
	},
});
