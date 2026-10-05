import { defineMusicEvent } from "../../structures/music/index.js";
import { logger } from "../../utils/logger.js";
import { deleteNowPlaying } from "../../utils/playerMessages.js";

export default defineMusicEvent({
	name: "trackEnd",
	async execute(client, player, track, reason, snapshot) {
		logger.debug(
			"Music",
			`[${snapshot.guildId}] Track ended: "${track.info.title}" | reason=${reason}`,
		);
		if (reason !== "replaced") {
			await deleteNowPlaying(player, client);
		}
	},
});
