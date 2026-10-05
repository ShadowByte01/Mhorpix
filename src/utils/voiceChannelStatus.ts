import type { BotClient } from "../core/BotClient.js";
import { emoji } from "../config/emoji.js";
import { logger } from "./logger.js";

/**
 * Maximum length for a Discord voice channel status.
 * Discord allows up to 500 chars, but we cap shorter for mobile safety.
 */
const VC_STATUS_MAX_LENGTH = 480;

/**
 * Sanitises a string so it is safe to use as a Discord voice channel status.
 * Strips markdown and control characters, but preserves Unicode (Japanese,
 * Hindi, emoji, etc.).
 */
function sanitizeForVcStatus(input: string): string {
	return input
		.normalize("NFKD")
		.replace(/[*_`~|#\[\]()<>]/g, "")
		.replace(/[\u0000-\u001F\u007F]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function buildVcStatus(title: string, author: string, upNext: string | null): string {
	const cleanTitle = sanitizeForVcStatus(title) || "Unknown";
	const cleanAuthor = sanitizeForVcStatus(author) || "Unknown";

	let statusText = `${cleanTitle} by |~ ${cleanAuthor}`;
	if (upNext) {
		statusText += ` | Up Next: ${upNext}`;
	}

	let status = `${emoji.get("music")} **${statusText}**`;

	if (status.length > VC_STATUS_MAX_LENGTH) {
		statusText =
			statusText.slice(0, VC_STATUS_MAX_LENGTH - 20 - emoji.get("music").length).trimEnd() + "…";
		status = `${emoji.get("music")} **${statusText}**`;
	}

	return status;
}

/**
 * Sets the status text of the voice channel the player is connected to.
 *
 * Uses the raw Discord REST endpoint: PATCH /channels/:id/voice-status
 * Body: { "status": "text" }
 *
 * The bot needs Manage Channels permission (Administrator covers this).
 * If it fails, the error is logged at WARN level (visible in console)
 * but playback is never blocked.
 */
export async function setVoiceChannelStatus(
	client: BotClient,
	channelId: string,
	status: string,
): Promise<void> {
	if (!channelId) return;
	try {
		await client.rest.put(`/channels/${channelId}/voice-status`, {
			body: { status },
		});
		logger.debug("VoiceChannelStatus", `Set VC status for ${channelId}: "${status.slice(0, 60)}"`);
	} catch (err) {
		const error = err as Error & { status?: number; code?: number };
		logger.warn(
			"VoiceChannelStatus",
			`Failed to set VC status for channel ${channelId}: ${error.message} (HTTP ${error.status ?? error.code ?? "?"})`,
		);
	}
}

/**
 * Clears the voice channel status (sets it to empty string).
 */
export async function clearVoiceChannelStatus(client: BotClient, channelId: string): Promise<void> {
	if (!channelId) return;
	try {
		await client.rest.put(`/channels/${channelId}/voice-status`, {
			body: { status: "" },
		});
		logger.debug("VoiceChannelStatus", `Cleared VC status for ${channelId}`);
	} catch (err) {
		const error = err as Error & { status?: number; code?: number };
		logger.warn(
			"VoiceChannelStatus",
			`Failed to clear VC status for channel ${channelId}: ${error.message} (HTTP ${error.status ?? error.code ?? "?"})`,
		);
	}
}

/**
 * Convenience helper: builds and sets the VC status for the player's current
 * voice channel based on the track that just started.
 */
export async function updatePlayerVcStatus(
	client: BotClient,
	voiceChannelId: string,
	track: { info: { title: string; author: string } },
	queueSize: number,
): Promise<void> {
	const upNext = queueSize > 0 ? `#${queueSize}` : null;
	const status = buildVcStatus(track.info.title, track.info.author, upNext);
	await setVoiceChannelStatus(client, voiceChannelId, status);
}
