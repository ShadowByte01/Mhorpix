import type { AutocompleteInteraction, ContainerBuilder, Message } from "discord.js";
import { ApplicationCommandOptionType, ComponentType, MessageFlags } from "discord.js";
import type { BotClient } from "../../core/BotClient.js";
import type { Playlist } from "../../db/stores/playlists.js";
import { addTrack, addTracks, getPlaylist, getUserPlaylists } from "../../db/stores/playlists.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import type { MusicPlayer, QueueTrack } from "../../structures/music/index.js";
import { defineCommand } from "../../types/index.js";
import {
	ActionRow,
	defContainer,
	errorContainer,
	primaryButton,
	SelectMenu,
	Separator,
	secondaryButton,
	successContainer,
	TextDisplay,
} from "../../utils/components.js";

const COLLECTOR_TIME = 60_000;

export default defineCommand({
	name: "playlist-add",
	aliases: ["pladd"],
	description: "Add the current track or queue to a playlist",
	category: "library",
	usage: "playlist-add [playlist]",
	slashUsage: "playlist-add [playlist]",
	enabledSlash: true,
	slashData: {
		name: "playlist-add",
		description: "Add the current track or queue to a playlist",
		options: [
			{
				type: ApplicationCommandOptionType.String,
				name: "playlist",
				description: "Playlist name or ID",
				required: false,
				autocomplete: true,
			},
		],
	},
	middleware: [
		Middleware.Cooldown(10),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.PlayerCheck("playing"),
	],
	async execute(ctx: CommandContext) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		const track = player?.currentTrack;
		if (!player || !track) {
			await ctx.reply({
				components: [errorContainer("Nothing Playing", "No track is currently playing.")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const query = (ctx.isSlash() ? ctx.options.getString("playlist") : ctx.args.join(" ")) ?? "";
		const owned = await getUserPlaylists(ctx.user.id);

		if (!owned.length) {
			await ctx.reply({
				components: [
					errorContainer("No Playlists", "Create a playlist first with `/playlist-create`."),
				],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		if (!query.trim()) {
			await showSelector(ctx, owned, player, track);
			return;
		}

		const match = owned.find((p) => p.id === query || p.name.toLowerCase() === query.toLowerCase());
		if (match) {
			await askType(ctx, match, player, track);
			return;
		}

		const fuzzy = owned.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
		if (!fuzzy.length) {
			await ctx.reply({
				components: [errorContainer("Not Found", "No matching playlist found.")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}
		if (fuzzy.length === 1 && typeof fuzzy[0] !== "undefined") {
			await askType(ctx, fuzzy[0], player, track);
			return;
		}
		await showSelector(ctx, fuzzy, player, track);
	},
	async autocomplete(interaction: AutocompleteInteraction, _client: BotClient) {
		const focused = interaction.options.getFocused(true);
		if (focused.name !== "playlist") return;

		const owned = await getUserPlaylists(interaction.user.id);
		const query = focused.value.toLowerCase();
		const filtered = (query ? owned.filter((p) => p.name.toLowerCase().includes(query)) : owned)
			.slice(0, 25)
			.map((p) => ({ name: p.name.slice(0, 100), value: p.id }));

		await interaction.respond(filtered).catch(() => undefined);
	},
});

function buildSelectorContainer(playlists: Playlist[], disable: boolean = false) {
	const options = playlists.slice(0, 25).map((p) => ({
		label: p.name.slice(0, 100),
		description: `${p.trackCount} tracks`,
		value: p.id,
	}));

	const select = SelectMenu("Choose a playlist", options, "pladd:select", 1, 1);
	select.setDisabled(disable);

	return defContainer()
		.addTextDisplayComponents(TextDisplay("### Select Playlist"))
		.addSeparatorComponents(Separator())
		.addActionRowComponents(ActionRow().addComponents(select));
}

async function showSelector(
	ctx: CommandContext,
	playlists: Playlist[],
	player: MusicPlayer,
	track: QueueTrack,
) {
	const msg = await ctx.reply({
		components: [buildSelectorContainer(playlists)],
		flags: MessageFlags.IsComponentsV2,
	});

	const collector = msg.createMessageComponentCollector({
		componentType: ComponentType.StringSelect,
		time: COLLECTOR_TIME,
		filter: (i) => i.user.id === ctx.user.id,
		max: 1,
	});

	collector.on("collect", async (i) => {
		await i.deferUpdate();
		let pl: Playlist | undefined;
		if (i.values[0]) {
			pl = (await getPlaylist(i.values[0])) ?? undefined;
		}
		if (pl) await askType(ctx, pl, player, track, msg);
	});

	collector.on("end", (collected, reason) => {
		if (reason === "time" && collected.size === 0) {
			msg.edit({ components: [buildSelectorContainer(playlists, true)] }).catch(() => undefined);
		}
	});
}

function buildAskType(pl: Playlist, queueSize: number, disable: boolean = false) {
	return defContainer()
		.addTextDisplayComponents(TextDisplay(`### Add to ${pl.name}`))
		.addSeparatorComponents(Separator())
		.addTextDisplayComponents(TextDisplay("Select what to add"))
		.addSeparatorComponents(Separator(false))
		.addActionRowComponents(
			ActionRow().addComponents(
				primaryButton("Current Track", "pladd:current", disable),
				secondaryButton("Entire Queue", "pladd:queue", disable || queueSize === 0),
			),
		);
}

async function askType(
	ctx: CommandContext,
	pl: Playlist,
	player: MusicPlayer,
	track: QueueTrack,
	msg?: Message,
) {
	const queueSize = player.queue?.size ?? 0;
	const container = buildAskType(pl, queueSize);

	const responseMessage = msg
		? await msg.edit({ components: [container] })
		: await ctx.reply({
				components: [container],
				flags: MessageFlags.IsComponentsV2,
			});

	const collector = responseMessage.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: COLLECTOR_TIME,
		filter: (interaction) => interaction.user.id === ctx.user.id,
		max: 1,
	});

	collector.on("collect", async (interaction) => {
		await interaction.deferUpdate();
		await processAdd(ctx, pl, interaction.customId, player, track, responseMessage);
	});

	collector.on("end", (collected, reason) => {
		if (reason === "time" && collected.size === 0) {
			responseMessage
				.edit({ components: [buildAskType(pl, queueSize, true)] })
				.catch(() => undefined);
		}
	});
}

async function processAdd(
	ctx: CommandContext,
	pl: Playlist,
	customId: string,
	player: MusicPlayer,
	track: QueueTrack,
	msg: Message,
) {
	let container: ContainerBuilder;

	if (customId === "pladd:queue") {
		const queueTracks = player.queue.toArray();
		const tracks = [track.encoded, ...queueTracks.map((t) => t.encoded)];
		const result = await addTracks(pl.id, ctx.user.id, tracks);

		if (result.success) {
			const info = `-# ${result.data.added} track${result.data.added !== 1 ? "s" : ""} added${result.data.skipped ? ` (${result.data.skipped} skipped)` : ""}`;
			container = successContainer()
				.addTextDisplayComponents(TextDisplay("### Added"))
				.addSeparatorComponents(Separator())
				.addTextDisplayComponents(TextDisplay(info));
		} else {
			const reasons: Record<string, string> = {
				NOT_FOUND: "Playlist not found",
				NO_PERMISSION: "No edit permission",
				TRACK_LIMIT: `Track limit reached (${result.limit ?? "?"})`,
				DUPLICATE: "Track already exists",
				NO_NEW_TRACKS: "All tracks already exist",
				INVALID_INPUT: "Invalid input",
			};
			container = errorContainer("Failed", reasons[result.error] || "Unknown error");
		}
	} else {
		const result = await addTrack(pl.id, ctx.user.id, track.encoded);

		if (result.success) {
			container = successContainer()
				.addTextDisplayComponents(TextDisplay(`### Added to ${pl.name}`))
				.addSeparatorComponents(Separator())
				.addTextDisplayComponents(TextDisplay(`**${track.info.title}**`));
		} else {
			const reasons: Record<string, string> = {
				NOT_FOUND: "Playlist not found",
				NO_PERMISSION: "No edit permission",
				TRACK_LIMIT: `Track limit reached (${result.limit ?? "?"})`,
				DUPLICATE: "Track already exists",
				NO_NEW_TRACKS: "All tracks already exist",
				INVALID_INPUT: "Invalid input",
			};
			container = errorContainer("Failed", reasons[result.error] || "Unknown error");
		}
	}

	await msg.edit({ components: [container] });
}
