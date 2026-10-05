import { defineMusicEvent } from "../../structures/music/index.js";
import { logger } from "../../utils/logger.js";
import { deleteNowPlaying, sendTrackError } from "../../utils/playerMessages.js";

/**
 * Fired by the Player when Lavalink reports a track exception.
 *
 * The Player already schedules an auto-advance to the next queue item via
 * `_scheduleAdvance()` right before emitting this event — so we do NOT need to
 * skip manually. We only:
 *   1. Log the real exception so the cause (YouTube auth, cipher, etc.) is
 *      visible in the console.
 *   2. Clean up the now-playing message.
 *   3. Tell the user the track was skipped.
 *
 * If the queue is empty after this, `queueFinish` runs and (when 24/7 is off)
 * destroys the player — that is the "bot left VC" behavior. Enabling 24/7 or
 * autoplay, or simply having more songs in the queue, keeps the bot in VC.
 */
export default defineMusicEvent({
	name: "trackError",
	async execute(client, player, track, exception, snapshot) {
		const severity = (exception as { severity?: string })?.severity ?? "UNKNOWN";
		const message = (exception as { message?: string })?.message ?? "no message";
		const cause = (exception as { cause?: string })?.cause ?? "";

		logger.error(
			"Music",
			`[${snapshot.guildId}] Track error: "${track.info.title}" | severity=${severity} | ${message}${cause ? ` | cause=${cause}` : ""}`,
		);

		await deleteNowPlaying(player, client);
		await sendTrackError(player, client);
	},
});
