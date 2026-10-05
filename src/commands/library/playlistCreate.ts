import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import {
	createPlaylist,
	getPlaylistLimit,
	getUserPlaylistCount,
} from "../../db/stores/playlists.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import { defineCommand } from "../../types/index.js";
import {
	errorContainer,
	Separator,
	successContainer,
	TextDisplay,
} from "../../utils/components.js";

export default defineCommand({
	name: "playlist-create",
	aliases: ["plcreate"],
	description: "Create a new playlist",
	category: "library",
	usage: "playlist-create <name>",
	slashUsage: "playlist-create <name>",
	enabledSlash: true,
	slashData: {
		name: "playlist-create",
		description: "Create a new playlist",
		options: [
			{
				type: ApplicationCommandOptionType.String,
				name: "name",
				description: "Name of the playlist",
				required: true,
			},
		],
	},
	middleware: [Middleware.Cooldown(10), Middleware.VoteRequired()],
	async execute(ctx: CommandContext) {
		const limit = await getPlaylistLimit(ctx.user.id);
		const current = await getUserPlaylistCount(ctx.user.id);

		if (current >= limit) {
			await ctx.reply({
				components: [
					errorContainer(
						"Limit Reached",
						`You have **${current}/${limit}** playlists. Remove some to create more.`,
					),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const name = ctx.isSlash() ? ctx.options.getString("name", true) : ctx.args.join(" ");
		if (!name.trim()) {
			await ctx.reply({
				components: [errorContainer("Missing Name", "Provide a name for the playlist.")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const result = await createPlaylist(ctx.user.id, name.trim());

		if (!result.success) {
			const reasons: Record<string, string> = {
				INVALID_NAME: "Invalid name provided",
				NAME_TOO_LONG: "Name too long (max 100 characters)",
				LIMIT_REACHED: "Playlist limit reached",
				DUPLICATE_NAME: "A playlist with this name already exists",
			};
			await ctx.reply({
				components: [errorContainer("Could Not Create", reasons[result.error] || "Unknown error")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		await ctx.reply({
			components: [
				successContainer()
					.addTextDisplayComponents(TextDisplay("### Playlist Created"))
					.addSeparatorComponents(Separator())
					.addTextDisplayComponents(TextDisplay(`**${result.data.name}**\n\`${result.data.id}\``))
					.addSeparatorComponents(Separator())
					.addTextDisplayComponents(TextDisplay(`-# ${current + 1}/${limit} playlists`)),
			],
			flags: MessageFlags.IsComponentsV2,
		});
	},
});
