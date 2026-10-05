import { ComponentType, MessageFlags } from "discord.js";
import { emoji } from "../../config/emoji.js";
import {
	addFavourite,
	getFavouriteCount,
	getFavouritesLimit,
	isFavourited,
	removeFavourite,
} from "../../db/stores/music.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import type { MusicPlayer, QueueTrack } from "../../structures/music/index.js";
import { defineCommand } from "../../types/index.js";
import {
	ActionRow,
	dangerButton,
	defContainer,
	errorContainer,
	linkButton,
	primaryButton,
	Separator,
	TextDisplay,
} from "../../utils/components.js";
import { TrackDecoder } from "../../utils/trackDecoder.js";

const COLLECTOR_TIME = 300_000;

function sanitize(text: string, maxLen: number): string {
	if (!text) return "";
	const cleaned = text.replace(/[[\]()]/g, "").trim();
	return maxLen && cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 3)}...` : cleaned;
}

export function buildNowPlaying(
	player: MusicPlayer,
	track: QueueTrack,
	favourited: boolean,
	disabled = false,
) {
	const container = defContainer();
	container.addTextDisplayComponents(TextDisplay("### Now Playing"));

	const fullArtist = track.info.author || "Unknown";
	const mainArtist = sanitize(fullArtist.split(/,|\/|;/)[0]?.trim() || "Unknown", 40);
	const safeTitle = sanitize(track.info.title, 50);
	const duration = track.info.isStream ? "Live" : TrackDecoder.formatDuration(track.info.length);
	const position = track.info.isStream ? "" : TrackDecoder.formatDuration(player.position);

	container.addTextDisplayComponents(
		TextDisplay(`**[${safeTitle}](${track.info.uri})**\n-# ${emoji.get("artist")} ${mainArtist}`),
	);

	if (track.info.isStream) {
		container.addTextDisplayComponents(TextDisplay(`-# ${emoji.get("duration_grey")} \`Live\``));
	} else if (track.info.isSeekable) {
		const filled = Math.round(15 * (player.position / track.info.length));
		const bar = `${"▓".repeat(Math.max(0, filled))}${"░".repeat(Math.max(0, 15 - filled))}`;
		container.addTextDisplayComponents(
			TextDisplay(`-# ${emoji.get("duration_grey")} \`${position}\` ${bar} \`${duration}\``),
		);
	}

	container.addSeparatorComponents(Separator());

	const row = ActionRow();
	if (!track.info.isStream) {
		row.addComponents(
			favourited
				? dangerButton("Remove Favourite", "np:toggle_fav", disabled)
				: primaryButton("Add Favourite", "np:toggle_fav", disabled),
		);
	}
	if (track.pluginInfo?.albumUrl) {
		row.addComponents(linkButton("View Album", track.pluginInfo.albumUrl as string));
	}
	if (row.components.length > 0) container.addActionRowComponents(row);

	const footer = [`Added by ${track.requester.username}`];
	if (player.queue.size > 0) footer.push(`${player.queue.size} in queue`);
	container.addTextDisplayComponents(TextDisplay(`-# ${footer.join(" • ")}`));

	return container;
}

export default defineCommand({
	name: "nowplaying",
	aliases: ["np", "current", "playing"],
	description: "Show the currently playing track",
	category: "music",
	enabledSlash: true,
	slashData: {
		name: "nowplaying",
		description: "Show the currently playing track",
	},
	middleware: [Middleware.GuildOnly()],
	async execute(ctx: CommandContext) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);

		if (!player) {
			await ctx.reply({
				components: [errorContainer("No Player", "There is no active player in this server.")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const track = player.currentTrack;
		if (!track) {
			await ctx.reply({
				components: [errorContainer("No Track Playing", "There is no track currently playing.")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		let fav = track.info.isStream ? false : await isFavourited(ctx.user.id, track.encoded);

		const msg = await ctx.reply({
			components: [buildNowPlaying(player, track, fav)],
			flags: MessageFlags.IsComponentsV2,
		});

		if (track.info.isStream) return;

		const collector = msg.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: COLLECTOR_TIME,
			filter: (i) => i.customId === "np:toggle_fav",
		});

		collector.on("collect", async (i) => {
			if (i.user.id !== ctx.user.id) {
				await i.reply({
					components: [errorContainer("Not Authorized", "You are not authorized to do this.")],
					flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				});
				return;
			}

			await i.deferUpdate();

			const current = player.currentTrack;
			if (!current || current.encoded !== track.encoded) {
				collector.stop();
				return;
			}

			if (fav) {
				const removed = await removeFavourite(ctx.user.id, track.encoded);
				if (removed) {
					fav = false;
					await msg.edit({ components: [buildNowPlaying(player, track, fav)] });
				}
				return;
			}

			const limit = await getFavouritesLimit(ctx.user.id);
			const count = await getFavouriteCount(ctx.user.id);
			if (count >= limit) {
				await i.followUp({
					components: [
						errorContainer(
							"Limit Reached",
							`Maximum of **${limit}** favourites. Remove some before adding more.`,
						),
					],
					flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				});
				return;
			}

			const result = await addFavourite(ctx.user.id, track.encoded);
			if (result.ok) {
				fav = true;
				await msg.edit({ components: [buildNowPlaying(player, track, fav)] });
			}
		});

		collector.on("end", () => {
			msg.edit({ components: [buildNowPlaying(player, track, fav, true)] }).catch(() => undefined);
		});
	},
});
