import { defineMusicEvent } from "../../structures/music/index.js";
import { clearPlayerSnapshot } from "../../structures/music/persistence.js";
import { logger } from "../../utils/logger.js";
import { clearVoiceChannelStatus } from "../../utils/voiceChannelStatus.js";

export default defineMusicEvent({
	name: "playerDestroy",
	async execute(client, player, snapshot) {
		logger.debug(
			"Music",
			`[${snapshot.guildId}] Player destroyed | lastTrack="${snapshot.currentTrack?.info.title ?? "none"}"`,
		);
		// Clear the VC status when the player is destroyed (stop/leave).
		if (snapshot.voiceChannelId) {
			await clearVoiceChannelStatus(client, snapshot.voiceChannelId);
		}
		void player;
		await clearPlayerSnapshot(snapshot.guildId);
	},
});
