import { ComponentType, MessageFlags } from "discord.js";
import {
	addFavourite,
	getFavouriteCount,
	getFavouritesLimit,
	isFavourited,
	removeFavourite,
} from "../../db/stores/music.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import type { QueueTrack } from "../../structures/music/index.js";
import { defineCommand } from "../../types/index.js";
import {
	ActionRow,
	dangerButton,
	defContainer,
	errorContainer,
	Separator,
	secondaryButton,
	successContainer,
	TextDisplay,
} from "../../utils/components.js";

const COLLECTOR_TIME = 60_000;

function trackLine(track: QueueTrack): string {
	return `**[${track.info.title}](${track.info.uri ?? ""})**`;
}

export default defineCommand({
	name: "favourite",
	aliases: ["fav", "favorite", "addfav", "like", "likes"],
	description: "Add or remove the currently playing track from your favourites",
	category: "library",
	enabledSlash: true,
	slashData: {
		name: "favourite",
		description: "Add or remove the currently playing track from your favourites",
	},
	middleware: [
		Middleware.Cooldown(10),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.PlayerCheck("playing"),
		Middleware.VoteRequired(),
	],
	async execute(ctx: CommandContext) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		const track = player?.currentTrack;

		if (!player || !track) {
			await ctx.reply({
				components: [errorContainer("Nothing Playing", "There's no track currently playing.")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		if (track.info.isStream) {
			await ctx.reply({
				components: [
					errorContainer(
						"Cannot Favourite Live Streams",
						"Live streams can't be saved to favourites.",
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const alreadyFavourited = await isFavourited(ctx.user.id, track.encoded);

		if (alreadyFavourited) {
			const confirm = defContainer()
				.addTextDisplayComponents(TextDisplay("### Remove from Favourites"))
				.addSeparatorComponents(Separator())
				.addTextDisplayComponents(TextDisplay(`-# Remove **${track.info.title}**?`))
				.addSeparatorComponents(Separator())
				.addActionRowComponents(
					ActionRow().addComponents(
						dangerButton("Remove", "favourite:confirm"),
						secondaryButton("Cancel", "favourite:cancel"),
					),
				);

			const message = await ctx.reply({
				components: [confirm],
				flags: MessageFlags.IsComponentsV2,
			});
			const collector = message.createMessageComponentCollector({
				componentType: ComponentType.Button,
				time: COLLECTOR_TIME,
				filter: (i) => i.user.id === ctx.user.id,
			});

			collector.on("collect", async (button) => {
				await button.deferUpdate();
				collector.stop();

				if (button.customId === "favourite:confirm") {
					const removed = await removeFavourite(ctx.user.id, track.encoded);
					const container = removed
						? successContainer()
								.addTextDisplayComponents(TextDisplay("### Removed from Favourites"))
								.addTextDisplayComponents(TextDisplay(trackLine(track)))
						: errorContainer("Failed", "Could not remove that track from your favourites.");

					await message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
					return;
				}

				await message.edit({
					components: [
						defContainer().addTextDisplayComponents(
							TextDisplay("Cancelled, track remains in favourites."),
						),
					],
					flags: MessageFlags.IsComponentsV2,
				});
			});

			collector.on("end", (_collected, reason) => {
				if (reason === "time") {
					message
						.edit({
							components: [defContainer().addTextDisplayComponents(TextDisplay("*Timed out.*"))],
							flags: MessageFlags.IsComponentsV2,
						})
						.catch(() => undefined);
				}
			});

			return;
		}

		const limit = await getFavouritesLimit(ctx.user.id);
		const count = await getFavouriteCount(ctx.user.id);
		if (count >= limit) {
			await ctx.reply({
				components: [
					errorContainer(
						"Limit Reached",
						`Maximum of **${limit}** favourites. Remove some before adding more.`,
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const result = await addFavourite(ctx.user.id, track.encoded);
		if (!result.ok) {
			const reason =
				result.reason === "ALREADY_FAVOURITED"
					? "That track is already in your favourites."
					: `Maximum of **${limit}** favourites.`;
			await ctx.reply({
				components: [errorContainer("Could Not Add Favourite", reason)],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		await ctx.reply({
			components: [
				successContainer()
					.addTextDisplayComponents(TextDisplay("### Added to Favourites"))

					.addTextDisplayComponents(TextDisplay(`${trackLine(track)}`))
					.addSeparatorComponents(Separator())
					.addTextDisplayComponents(
						TextDisplay(
							`-# ${result.favourites.length}/${limit} favourites • Use \`/favourites\` to view`,
						),
					),
			],
			flags: MessageFlags.IsComponentsV2,
		});
	},
});
