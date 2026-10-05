import { ComponentType, MessageFlags } from "discord.js";
import { clearSpotifyProfile, getSpotifyProfile } from "../../db/stores/music.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
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

export default defineCommand({
	name: "spotify-logout",
	aliases: ["splogout", "spdisconnect", "spotifylogout", "spunlink"],
	description: "Unlink your Spotify profile",
	category: "integrations",
	enabledSlash: true,
	slashData: {
		name: "spotify-logout",
		description: "Unlink your Spotify profile",
	},
	middleware: [Middleware.Cooldown(60), Middleware.VoteRequired()],
	async execute(ctx: CommandContext) {
		const profile = await getSpotifyProfile(ctx.user.id);
		if (!profile) {
			await ctx.reply({
				components: [errorContainer("Not Linked", "You don't have a Spotify profile linked.")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const confirm = defContainer()
			.addTextDisplayComponents(TextDisplay("### Unlink Spotify"))
			.addSeparatorComponents(Separator())
			.addTextDisplayComponents(
				TextDisplay("-# Are you sure you want to unlink your Spotify profile?"),
			)
			.addSeparatorComponents(Separator())
			.addActionRowComponents(
				ActionRow().addComponents(
					dangerButton("Unlink", "spotify_logout:confirm"),
					secondaryButton("Cancel", "spotify_logout:cancel"),
				),
			);

		const message = await ctx.reply({ components: [confirm], flags: MessageFlags.IsComponentsV2 });

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: COLLECTOR_TIME,
			max: 1,
			filter: (i) => i.user.id === ctx.user.id,
		});

		collector.on("collect", async (i) => {
			await i.deferUpdate();

			if (i.customId === "spotify_logout:confirm") {
				const removed = await clearSpotifyProfile(ctx.user.id);
				await message.edit({
					components: [
						removed
							? successContainer().addTextDisplayComponents(TextDisplay("### Spotify Unlinked"))
							: errorContainer("Failed", "Could not unlink your Spotify profile."),
					],
					flags: MessageFlags.IsComponentsV2,
				});
				return;
			}

			await message.edit({
				components: [
					defContainer().addTextDisplayComponents(
						TextDisplay("-# Cancelled — profile stays linked."),
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});
		});

		collector.on("end", (_collected, reason) => {
			if (reason === "time") {
				message
					.edit({
						components: [defContainer().addTextDisplayComponents(TextDisplay("-# Timed out."))],
						flags: MessageFlags.IsComponentsV2,
					})
					.catch(() => undefined);
			}
		});
	},
});
