import { ApplicationCommandOptionType, type AutocompleteInteraction, MessageFlags } from "discord.js";
import { Middleware, clearCommandCooldown } from "../../middlewares/index.js";
import type { BotClient } from "../../core/BotClient.js";
import type { CommandContext } from "../../structures/context/index.js";
import type { MusicPlayer, QueueTrack } from "../../structures/music/index.js";
import { ManagerError, PlayerError } from "../../structures/music/index.js";
import { type ResolveQueryResult, resolveQuery } from "../../structures/music/musicSearch.js";
import { SearchSource } from "../../structures/music/types.js";
import { defineCommand } from "../../types/index.js";
import {
        baseSection,
        dangerButton,
        defContainer,
        errorContainer,
        Separator,
        TextDisplay,
} from "../../utils/components.js";
import { filterShortTracks, formatMinDurationNotice } from "../../utils/duration.js";
import { logger } from "../../utils/logger.js";
import { unsuppressIfStage } from "../../utils/stage.js";

async function handleResult(
        ctx: CommandContext,
        result: ResolveQueryResult,
        tracks: QueueTrack[],
        player: MusicPlayer,
        wasIdle: boolean,
        removed = 0,
): Promise<void> {
        switch (result.type) {
                case "playlist": {
                        const container = defContainer().addTextDisplayComponents(
                                TextDisplay(
                                        [
                                                `**Playlist queued** — \`${result.playlistName ?? "Unknown playlist"}\``,
                                                `Added **${tracks.length}** tracks`,
                                                wasIdle ? "Started playing now" : null,
                                                formatMinDurationNotice(removed),
                                        ]
                                                .filter(Boolean)
                                                .join("\n"),
                                ),
                        );
                        await ctx.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                        return;
                }

                case "track": {
                        const track = tracks[0];
                        if (!track) return;
                        const { title, uri, author } = track.info;
                        const queueSize = player.queue.size;

                        const container = defContainer()
                                .addTextDisplayComponents(TextDisplay(wasIdle ? " Now Playing" : "Added to Queue"))
                                .addSeparatorComponents(Separator())
                                .addSectionComponents(
                                        baseSection()
                                                .addTextDisplayComponents(
                                                        TextDisplay(
                                                                [
                                                                        `**[${title}](${uri})**`,
                                                                        author,
                                                                        queueSize ? `-# **Up Next:** \`#${queueSize}\`` : null,
                                                                ]
                                                                .filter(Boolean)
                                                                .join("\n"),
                                                        ),
                                                )
                                                .setButtonAccessory(
                                                        dangerButton(
                                                                "Remove",
                                                                `playRemove:${track.encoded.slice(20, 100)}`,
                                                                wasIdle === true,
                                                        ),
                                                ),
                                );
                        await ctx.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                        return;
                }
        }
}

async function fetchSearchResult(ctx: CommandContext, query: string) {
        try {
                const result = await resolveQuery({
                        manager: ctx.client.music,
                        query,
                });

                switch (result.type) {
                        case "empty":
                                await ctx.reply({
                                        components: [errorContainer("No Results", `Nothing found for **${query}**`)],
                                        flags: MessageFlags.IsComponentsV2,
                                });
                                return null;
                        case "error":
                                await ctx.reply({
                                        components: [
                                                errorContainer(
                                                        "Search Error",
                                                        result.errorMessage ||
                                                                "The track could not be loaded. It may be unavailable or region-locked.",
                                                ),
                                        ],
                                        flags: MessageFlags.IsComponentsV2,
                                });
                                return null;
                        default:
                                return result;
                }
        } catch (err) {
                logger.warn("Play", `Search failed: ${(err as Error).message}`);
                await ctx.reply({
                        components: [errorContainer("Search Failed", "Could not reach Lavalink. Try again.")],
                        flags: MessageFlags.IsComponentsV2,
                });
                return null;
        }
}

async function resolvePlayer(
        ctx: CommandContext,
        voiceChannelId: string,
): Promise<MusicPlayer | null> {
        const music = ctx.client.music;
        const guildId = ctx.guild.id;

        let player = music.getPlayer(guildId);
        try {
                if (!player) {
                        player = await music.createPlayer({
                                guildId,
                                voiceChannelId,
                                textChannelId: ctx.channel.id,
                                deaf: true,
                        });
                } else {
                        player.setTextChannel(ctx.channel.id);
                }
                return player;
        } catch (err) {
                if (err instanceof ManagerError && err.code === "PLAYER_EXISTS") {
                        const existing = music.getPlayer(guildId);
                        if (existing) return existing;
                }

                logger.warn("Play", `Failed to create player: ${(err as Error).message}`);
                await ctx.reply({
                        components: [errorContainer("Connection Failed", "Could not join your voice channel.")],
                        flags: MessageFlags.IsComponentsV2,
                });
                return null;
        }
}

async function enqueueAndPlay(
        ctx: CommandContext,
        player: MusicPlayer,
        tracks: QueueTrack[],
        result: ResolveQueryResult,
        removed = 0,
): Promise<void> {
        try {
                player.add(tracks);
        } catch (err) {
                if (err instanceof PlayerError && err.code === "QUEUE_FULL") {
                        await ctx.reply({
                                components: [errorContainer("Queue Full", err.message)],
                                flags: MessageFlags.IsComponentsV2,
                        });
                        return;
                }
                throw err;
        }

        const wasIdle = player.currentTrack === null;
        if (wasIdle) {
                try {
                        await player.play();
                } catch (err) {
                        logger.error("Play", `Playback failed: ${(err as Error).message}`, err as Error);
                        await ctx.reply({
                                components: [
                                        errorContainer(
                                                "Playback Failed",
                                                "Could not start playing. The track may be unavailable.",
                                        ),
                                ],
                                flags: MessageFlags.IsComponentsV2,
                        });
                        return;
                }
        }

        await handleResult(ctx, result, tracks, player, wasIdle, removed);
}

/* ------------------------------------------------------------------ */
/* Autocomplete — live song recommendations while typing the query.   */
/* ------------------------------------------------------------------ */

const IS_LINK_RE = /^https?:\/\//i;
const AC_TIMEOUT_MS = 2_500;
const AC_CACHE_TTL_MS = 1_500;

interface AcCacheEntry {
        expiresAt: number;
        choices: { name: string; value: string }[];
}

const autocompleteCache = new Map<string, AcCacheEntry>();

function formatDurationShort(ms: number | undefined | null): string {
        if (!ms || ms <= 0) return "Live";
        const totalSec = Math.floor(ms / 1_000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m}:${s.toString().padStart(2, "0")}`;
}

async function searchAutocomplete(
        client: BotClient,
        query: string,
): Promise<{ name: string; value: string }[]> {
        const cached = autocompleteCache.get(query);
        if (cached && cached.expiresAt > Date.now()) {
                return cached.choices;
        }

        const doSearch = async (source: SearchSource) => {
                try {
                        const result = await client.music.search(query, source);
                        if (result.type === "search" || result.type === "track") {
                                return result.tracks;
                        }
                } catch (err) {
                        logger.debug("Play:Autocomplete", `${source} search failed: ${(err as Error).message}`);
                }
                return [];
        };

        let pool = await doSearch(SearchSource.YouTubeMusic);
        if (pool.length < 5) {
                const [yt, sp] = await Promise.all([
                        doSearch(SearchSource.YouTube),
                        doSearch(SearchSource.Spotify),
                ]);
                pool = pool.concat(yt);
                if (pool.length < 5) pool = pool.concat(sp);
        }

        // De-duplicate by encoded track id, keep order.
        const seen = new Set<string>();
        const unique = pool.filter((t) => {
                if (seen.has(t.encoded)) return false;
                seen.add(t.encoded);
                return true;
        });

        const choices = unique.slice(0, 25).map((t) => {
                const title = (t.info.title || "Unknown").replace(/\|/g, " ").trim();
                const author = (t.info.author || "Unknown").replace(/\|/g, " ").trim();
                const dur = t.info.isStream ? "Live" : formatDurationShort(t.info.length);
                const name = `${title} — ${author} [${dur}]`.slice(0, 100);
                const value = (t.info.uri || title).slice(0, 100);
                return { name, value };
        });

        autocompleteCache.set(query, { expiresAt: Date.now() + AC_CACHE_TTL_MS, choices });

        // Keep the cache bounded.
        if (autocompleteCache.size > 200) {
                const oldest = [...autocompleteCache.entries()].sort(
                        (a, b) => a[1].expiresAt - b[1].expiresAt,
                );
                for (const [k] of oldest.slice(0, 100)) autocompleteCache.delete(k);
        }

        return choices;
}

async function handleAutocomplete(interaction: AutocompleteInteraction, client: BotClient): Promise<void> {
        const focused = interaction.options.getFocused(true);
        if (!focused || focused.name !== "query") {
                await interaction.respond([]);
                return;
        }

        const query = (focused.value ?? "").trim();
        if (query.length < 2 || IS_LINK_RE.test(query)) {
                await interaction.respond([]);
                return;
        }

        let choices: { name: string; value: string }[] = [];
        try {
                const timeout = new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error("autocomplete timeout")), AC_TIMEOUT_MS),
                );
                choices = await Promise.race([searchAutocomplete(client, query), timeout]);
        } catch (err) {
                logger.debug("Play:Autocomplete", `Failed: ${(err as Error).message}`);
        }

        try {
                await interaction.respond(choices.slice(0, 25));
        } catch {
                // "Application did not respond" — interaction already expired, ignore.
        }
}

export default defineCommand({
        name: "play",
        aliases: ["p"],
        description: "Play a song or add it to the queue",
        usage: "play <query | url>",
        slashUsage: "play <query | url>",
        category: "music",
        enabledSlash: true,
        slashData: {
                name: "play",
                description: "Play a song or add it to the queue",
                options: [
                        {
                                type: ApplicationCommandOptionType.String,
                                name: "query",
                                description: "Song name or URL to play — type to get recommendations",
                                required: true,
                                autocomplete: true,
                        },
                ],
        },
        middleware: [
                Middleware.Cooldown(2),
                Middleware.GuildOnly(),
                Middleware.VoiceRequired(),
                Middleware.SameVoiceChannel(),
                Middleware.LinkGate(),
        ],
        autocomplete: handleAutocomplete,
        async execute(ctx) {
                await ctx.deferReply();

                // If anything below fails, clear the cooldown so the user can retry
                // immediately instead of being locked out for the cooldown window.
                const releaseCooldown = (): void => {
                        void clearCommandCooldown("play", ctx.user.id, ctx.guild.id).catch(() => {
                                /** empty because redis errors here must not crash playback flow */
                        });
                };

                const query = ctx.isSlash() ? ctx.options.getString("query", true) : ctx.args.join(" ");
                const voiceChannelId = ctx.member?.voice?.channel?.id;

                if (!voiceChannelId) {
                        releaseCooldown();
                        await ctx.reply({
                                components: [
                                        errorContainer("No Voice Channel", "You must be in a voice channel to play music."),
                                ],
                                flags: MessageFlags.IsComponentsV2,
                        });
                        return;
                }

                if (!query.trim()) {
                        releaseCooldown();
                        await ctx.reply({
                                components: [errorContainer("Missing Query", "Provide a song name or URL to play.")],
                                flags: MessageFlags.IsComponentsV2,
                        });
                        return;
                }

                const result = await fetchSearchResult(ctx, query);
                if (!result) {
                        releaseCooldown();
                        return;
                }

                const candidateTracks =
                        result.type === "playlist" ? result.tracks : result.tracks[0] ? [result.tracks[0]] : [];
                if (!candidateTracks.length) {
                        releaseCooldown();
                        return;
                }

                const { kept: rawTracks, removed } = filterShortTracks(candidateTracks);
                if (!rawTracks.length) {
                        releaseCooldown();
                        await ctx.reply({
                                components: [
                                        errorContainer(
                                                "Track Too Short",
                                                "Tracks under 45 seconds and live streams can't be played.",
                                        ),
                                ],
                                flags: MessageFlags.IsComponentsV2,
                        });
                        return;
                }

                const player = await resolvePlayer(ctx, voiceChannelId);
                if (!player) {
                        releaseCooldown();
                        return;
                }

                const stageResult = await unsuppressIfStage(ctx.guild, voiceChannelId, ctx.client);
                if (!stageResult.ok) {
                        releaseCooldown();
                        await ctx.reply({
                                components: [
                                        errorContainer(
                                                "Stage Channel",
                                                stageResult.reason ?? "I couldn't become a speaker in this Stage channel.",
                                        ),
                                ],
                                flags: MessageFlags.IsComponentsV2,
                        });
                        return;
                }

                const requester = {
                        id: ctx.user.id,
                        username: ctx.user.username,
                        displayName: ctx.user.displayName,
                };
                const now = Date.now();
                const tracks: QueueTrack[] = rawTracks.map((t) => ({ ...t, requester, addedAt: now }));

                try {
                        await enqueueAndPlay(ctx, player, tracks, result, removed);
                } catch (err) {
                        // Unexpected error during enqueue/play — release cooldown so the
                        // user can retry right away, and surface a clear message.
                        releaseCooldown();
                        logger.error("Play", `enqueueAndPlay threw: ${(err as Error).message}`, err as Error);
                        await ctx
                                .reply({
                                        components: [
                                                errorContainer(
                                                        "Playback Error",
                                                        "Something went wrong while starting playback. Try again.",
                                                ),
                                        ],
                                        flags: MessageFlags.IsComponentsV2,
                                })
                                .catch(() => {
                                        /** empty because reply may already have been sent */
                                });
                }
        },
});
