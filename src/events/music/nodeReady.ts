import { defineMusicEvent } from "../../structures/music/index.js";
import { logger } from "../../utils/logger.js";

let hasAttemptedResume = false;

export default defineMusicEvent({
	name: "nodeReady",
	async execute(client, nodeName, lavalinkResume, libraryResume) {
		if (hasAttemptedResume) return;
		hasAttemptedResume = true;

		logger.debug(
			"Music",
			`[${nodeName}] First ready this process | lavalinkResume=${lavalinkResume} libraryResume=${libraryResume}`,
		);

		try {
			await client.music.resumeAllFromSnapshots();
		} catch (err) {
			logger.error("Music:Resume", err instanceof Error ? err.message : String(err));
		}
	},
});
