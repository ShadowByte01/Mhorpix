import { defineMusicEvent } from "../../structures/music/index.js";
import { logger } from "../../utils/logger.js";

export default defineMusicEvent({
	name: "error",
	execute(_client, player, error) {
		const context = player !== null ? `[${player.guildId}]` : "[Manager]";
		logger.error("Music", `${context} Internal error: ${error.message}`, error);
	},
});
