import { ComponentType, MessageFlags, TextInputStyle } from "discord.js";
import { getSpotifyProfile, setSpotifyProfile } from "../../db/stores/music.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import { defineCommand } from "../../types/index.js";
import {
	ActionRow,
	defContainer,
	errorContainer,
	Label,
	Modal,
	primaryButton,
	successContainer,
	TextDisplay,
	TextInput,
} from "../../utils/components.js";
import { logger } from "../../utils/logger.js";
import { extractSpotifyId, fetchSpotifyUser, SpotifyNotFoundError } from "../../utils/spotify.js";

const MODAL_ID = "spotify_login_modal";
const INPUT_ID = "spotify_login_input";
const COLLECTOR_TIME = 60_000;

export default defineCommand({
	name: "spotify-login",
	aliases: ["splogin", "spconnect", "spotifylogin", "splink"],
	description: "Link your Spotify profile",
	category: "integrations",
	enabledSlash: true,
	slashData: {
		name: "spotify-login",
		description: "Link your Spotify profile",
	},
	middleware: [Middleware.Cooldown(60), Middleware.VoteRequired()],
	async execute(ctx: CommandContext) {
		const existing = await getSpotifyProfile(ctx.user.id);
		if (existing) {
			await ctx.reply({
				components: [
					errorContainer(
						"Already Linked",
						"You already have a Spotify profile linked. Use `/spotify-logout` first.",
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const buildInitial = (disable: boolean = false) =>
			defContainer()
				.addTextDisplayComponents(TextDisplay("### Link Spotify"))
				.addActionRowComponents(
					ActionRow().addComponents(primaryButton("Enter Profile", "spotify_login:open", disable)),
				);

		const message = await ctx.reply({
			components: [buildInitial()],
			flags: MessageFlags.IsComponentsV2,
		});

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: COLLECTOR_TIME,
			max: 1,
			filter: (i) => i.user.id === ctx.user.id,
		});

		collector.on("collect", async (i) => {
			if (i.customId !== "spotify_login:open") return;

			const modal = Modal(MODAL_ID, "Link Spotify").addLabelComponents(
				Label(
					"Profile URL or username",
					TextInput(INPUT_ID, TextInputStyle.Short, true),
					"e.g. https://open.spotify.com/user/yourname",
				),
			);
			await i.showModal(modal);
			await message.edit({ components: [buildInitial(true)] }).catch(() => undefined);

			try {
				const submission = await i.awaitModalSubmit({
					time: 120_000,
					filter: (s) => s.customId === MODAL_ID && s.user.id === ctx.user.id,
				});

				const raw = submission.fields.getTextInputValue(INPUT_ID);
				const spotifyId = extractSpotifyId(raw);

				if (!spotifyId) {
					await submission.deferUpdate();
					await message.edit({
						components: [
							errorContainer("Invalid Input", "Enter a valid Spotify profile URL or username."),
						],
						flags: MessageFlags.IsComponentsV2,
					});
					return;
				}

				let profile: Awaited<ReturnType<typeof fetchSpotifyUser>>;
				try {
					profile = await fetchSpotifyUser(spotifyId);
				} catch (err) {
					await submission.deferUpdate();
					const notFound = err instanceof SpotifyNotFoundError;
					await message.edit({
						components: [
							errorContainer(
								notFound ? "Profile Not Found" : "Spotify Error",
								notFound
									? "Could not find that Spotify profile."
									: "Failed to reach Spotify. Try again shortly.",
							),
						],
						flags: MessageFlags.IsComponentsV2,
					});
					return;
				}

				await setSpotifyProfile(ctx.user.id, profile.id);
				await submission.deferUpdate();
				await message.edit({
					components: [
						successContainer()
							.addTextDisplayComponents(TextDisplay("### Spotify Linked"))
							.addTextDisplayComponents(
								TextDisplay(
									`-# **${profile.displayName}** • ${profile.playlists.length} public playlist${profile.playlists.length !== 1 ? "s" : ""}`,
								),
							),
					],
					flags: MessageFlags.IsComponentsV2,
				});
			} catch (err) {
				// Modal timed out or was dismissed — nothing to clean up.
				logger.warn(
					"SpotifyLogin",
					`Modal flow ended without submission: ${(err as Error).message}`,
				);
			}
		});

		collector.on("end", (collected, reason) => {
			if (reason === "time" && collected.size === 0) {
				message.edit({ components: [buildInitial(true)] }).catch(() => undefined);
			}
		});
	},
});
