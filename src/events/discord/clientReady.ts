import { ActivityType, type PresenceData } from "discord.js";
import { defineEvent } from "../../types/index.js";
import { startCrons } from "../../utils/crons/index.js";
import { logger } from "../../utils/logger.js";

/**
 * The bot's presence.
 *
 * - status: "dnd" → red Do-Not-Disturb indicator on the bot avatar.
 * - Activity 1 (Listening): "!!play" → appears in the bio/activity area
 *   below the username. Put FIRST so Discord always shows it.
 * - Activity 2 (Custom): "melody~24/7" → appears as the custom status text
 *   right beside the bot's name/logo (the "thinking" line).
 *
 * Discord shows the first non-custom activity in the member list + bio,
 * and the custom status as the italic text beside the name.
 */
const BOT_PRESENCE: PresenceData = {
        status: "dnd",
        activities: [
                {
                        type: ActivityType.Listening,
                        name: "Xentara | /help",
                },
                {
                        type: ActivityType.Custom,
                        name: "custom",
                        state: "melody~24/7",
                }
        ],
};

function applyPresence(client: import("../../core/BotClient.js").BotClient): void {
        if (!client.user) return;
        try {
                client.user.setPresence(BOT_PRESENCE);
        } catch (err: unknown) {
                logger.warn("Bot", `Failed to set presence: ${(err as Error).message}`);
        }
}

export default defineEvent({
        name: "clientReady",
        once: true,
        async execute(client) {
                if (!client.user) return;
                logger.success("Bot", `Logged in as ${client.user.tag}`);

                const isPrimaryProcess = !client.cluster || client.cluster.id === 0;
                if (!isPrimaryProcess) return;

                // Apply the custom presence on startup.
                applyPresence(client);

                // Re-apply presence every 5 minutes. Discord occasionally drops custom
                // presence after gateway reconnects/resumes; this keeps it sticky.
                setInterval(() => applyPresence(client), 5 * 60 * 1000);

                try {
                        await client.commands.registerSlashCommands();
                } catch (error) {
                        logger.error("Bot", "Failed to register slash commands", error as Error);
                }

                setTimeout(() => startCrons(client), 60_000);
        },
});
