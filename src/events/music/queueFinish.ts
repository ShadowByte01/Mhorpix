import { ChannelType, MessageFlags } from "discord.js";
import type { BotClient } from "../../core/BotClient.js";
import { guildStore } from "../../db/stores/guild.js";
import { executeAutoplay } from "../../structures/music/autoplay.js";
import type { MusicPlayer as Player, PlayerSnapshot } from "../../structures/music/index.js";
import { defineMusicEvent } from "../../structures/music/index.js";
import { clearPlayerSnapshot } from "../../structures/music/persistence.js";
import { defContainer, TextDisplay } from "../../utils/components.js";
import { logger } from "../../utils/logger.js";
import { deleteNowPlaying } from "../../utils/playerMessages.js";
import { clearVoiceChannelStatus } from "../../utils/voiceChannelStatus.js";

function buildQueueEndedLabel(twentyFourSeven: boolean): string {
        return twentyFourSeven ? "-# Queue ended. Staying in voice (24/7 mode)." : "-# Queue ended.";
}

async function sendQueueEndedNotice(
        client: BotClient,
        player: Player,
        snapshot: PlayerSnapshot,
        twentyFourSeven: boolean,
): Promise<void> {
        const channelId = snapshot.textChannelId ?? player.currentTextChannelId;
        if (!channelId) return;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel?.type !== ChannelType.GuildText) return;

        await channel
                .send({
                        components: [
                                defContainer().addTextDisplayComponents(TextDisplay(buildQueueEndedLabel(twentyFourSeven))),
                        ],
                        flags: MessageFlags.IsComponentsV2,
                })
                .catch(() => undefined);
}

export default defineMusicEvent({
        name: "queueFinish",
        async execute(client, player, snapshot) {
                logger.debug("Music", `[${snapshot.guildId}] Queue finished`);

                await deleteNowPlaying(player, client);

                // Clear the voice channel status since nothing is playing.
                if (snapshot.voiceChannelId) {
                        await clearVoiceChannelStatus(client, snapshot.voiceChannelId);
                }

                const guild = await guildStore.get(snapshot.guildId).catch(() => null);
                const isTwentyFourSeven = guild?.twentyFourSeven ?? false;
                if (!player.getAutoplay()) {
                        await sendQueueEndedNotice(client, player, snapshot, isTwentyFourSeven);
                }
                const lastTrack = player.queue.peekHistory();
                if (!lastTrack) {
                        logger.debug("Autoplay:queueFinish", "No history available for autoplay recovery");
                }
                if (player.getAutoplay() && lastTrack) {
                        try {
                                await executeAutoplay(player, client.music, lastTrack);
                                if (!player.hasCurrentTrack && player.queue.size > 0) {
                                        await player.play();
                                }
                        } catch (err) {
                                logger.error("Autoplay:queueFinish", err instanceof Error ? err.message : String(err));
                        }
                }

                if (isTwentyFourSeven) {
                        logger.debug("Music", `[${snapshot.guildId}] 24/7 enabled, keeping player alive`);
                        if (!player.hasCurrentTrack) await clearPlayerSnapshot(snapshot.guildId);
                        return;
                }
                if (!player.getAutoplay()) {
                        await clearPlayerSnapshot(snapshot.guildId);
                        await client.music.destroyPlayer(snapshot.guildId);
                }
        },
});
