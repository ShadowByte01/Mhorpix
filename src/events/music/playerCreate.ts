import { defineMusicEvent } from "../../structures/music/index.js";
import { logger } from "../../utils/logger.js";

export default defineMusicEvent({
	name: "playerCreate",
	execute(_client, player) {
		logger.debug("Music", `[${player.guildId}] Player created | voice=${player.voiceChannelId}`);
	},
});
