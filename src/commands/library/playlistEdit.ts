import {
	ApplicationCommandOptionType,
	type AutocompleteInteraction,
	ComponentType,
	type Message,
	MessageFlags,
	TextInputStyle,
} from "discord.js";
import type { BotClient } from "../../core/BotClient.js";
import type { Playlist } from "../../db/stores/playlists.js";
import {
	deletePlaylist,
	getPlaylist,
	getUserPlaylists,
	renamePlaylist,
} from "../../db/stores/playlists.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import { defineCommand } from "../../types/index.js";
import {
	ActionRow,
	dangerButton,
	defContainer,
	errorContainer,
	Label,
	Modal,
	SelectMenu,
	Separator,
	secondaryButton,
	successContainer,
	TextDisplay,
	TextInput,
} from "../../utils/components.js";

const COLLECTOR_TIME = 60_000;

export default defineCommand({
	name: "playlist-edit",
	aliases: ["pledit"],
	description: "Rename or delete a playlist",
	category: "library",
	usage: "playlist-edit [playlist]",
	slashUsage: "playlist-edit [playlist]",
	enabledSlash: true,
	slashData: {
		name: "playlist-edit",
		description: "Rename or delete a playlist",
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
	middleware: [Middleware.Cooldown(10)],
	async execute(ctx: CommandContext) {
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
			await showSelector(ctx, owned);
			return;
		}

		const match = owned.find((p) => p.id === query || p.name.toLowerCase() === query.toLowerCase());
		if (match) {
			await showEditor(ctx, match);
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
			await showEditor(ctx, fuzzy[0]);
			return;
		}
		await showSelector(ctx, fuzzy);
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

	const select = SelectMenu("Choose a playlist", options, "pledit:select", 1, 1);
	select.setDisabled(disable);

	return defContainer()
		.addTextDisplayComponents(TextDisplay("### Select Playlist"))
		.addSeparatorComponents(Separator())
		.addActionRowComponents(ActionRow().addComponents(select));
}

async function showSelector(ctx: CommandContext, playlists: Playlist[]) {
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

	collector.on("collect", async (interaction) => {
		await interaction.deferUpdate();
		const id = interaction.values[0];
		if (!id) return;
		const pl = await getPlaylist(id);
		if (pl) await showEditor(ctx, pl, msg);
	});

	collector.on("end", (collected, reason) => {
		if (reason === "time" && collected.size === 0) {
			msg.edit({ components: [buildSelectorContainer(playlists, true)] }).catch(() => undefined);
		}
	});
}

function buildEditor(pl: Playlist, disable: boolean = false) {
	return defContainer()
		.addTextDisplayComponents(TextDisplay(`### Edit ${pl.name}`))
		.addSeparatorComponents(Separator())
		.addTextDisplayComponents(TextDisplay(`**Name**\n${pl.name}`))
		.addSeparatorComponents(Separator(false))
		.addActionRowComponents(
			ActionRow().addComponents(
				secondaryButton("Rename", "pledit:rename", disable),
				dangerButton("Delete", "pledit:delete", disable),
			),
		)
		.addSeparatorComponents(Separator())
		.addTextDisplayComponents(TextDisplay(`-# ID: \`${pl.id}\``));
}

function buildConfirm(pl: Playlist, disable: boolean = false) {
	return defContainer()
		.addTextDisplayComponents(TextDisplay("### Delete Playlist"))
		.addSeparatorComponents(Separator())
		.addTextDisplayComponents(TextDisplay(`-# Delete **${pl.name}**?`))
		.addSeparatorComponents(Separator())
		.addActionRowComponents(
			ActionRow().addComponents(
				dangerButton("Confirm", "pledit:confirm", disable),
				secondaryButton("Cancel", "pledit:cancel", disable),
			),
		);
}

async function showEditor(ctx: CommandContext, pl: Playlist, msg?: Message) {
	const container = buildEditor(pl);
	const message = msg
		? await msg.edit({ components: [container] })
		: await ctx.reply({
				components: [container],
				flags: MessageFlags.IsComponentsV2,
			});

	let awaitingConfirm = false;

	const collector = message.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: COLLECTOR_TIME,
		filter: (interaction) => interaction.user.id === ctx.user.id,
	});

	collector.on("collect", async (interaction) => {
		if (interaction.customId === "pledit:rename") {
			await interaction.showModal(
				Modal(`pledit:rename:${pl.id}`, "Rename Playlist").addLabelComponents(
					Label(
						"New Name",
						TextInput("pledit:name", TextInputStyle.Short, true)
							.setValue(pl.name)
							.setMaxLength(100),
					),
				),
			);

			const submit = await interaction
				.awaitModalSubmit({
					filter: (s) => s.customId === `pledit:rename:${pl.id}` && s.user.id === ctx.user.id,
					time: 120_000,
				})
				.catch(() => null);

			if (!submit) return;

			await submit.deferUpdate();
			const name = submit.fields.getTextInputValue("pledit:name").trim();
			if (!name) {
				await submit.editReply({
					components: [errorContainer("Invalid Name", "Name cannot be empty.")],
					flags: MessageFlags.IsComponentsV2,
				});
				return;
			}

			const ok = await renamePlaylist(pl.id, ctx.user.id, name);
			const fresh = await getPlaylist(pl.id);

			await submit.editReply({
				components: [
					ok && fresh
						? successContainer()
								.addTextDisplayComponents(TextDisplay("### Renamed"))
								.addSeparatorComponents(Separator())
								.addTextDisplayComponents(TextDisplay(`**${fresh.name}**\n\`${fresh.id}\``))
						: errorContainer("Failed", "Could not rename playlist."),
				],
				flags: MessageFlags.IsComponentsV2,
			});

			if (fresh) {
				await message.edit({ components: [buildEditor(fresh)] });
			}
			return;
		}

		if (interaction.customId === "pledit:delete") {
			await interaction.deferUpdate();
			awaitingConfirm = true;
			await message.edit({ components: [buildConfirm(pl)] });

			const confirmCollector = message.createMessageComponentCollector({
				componentType: ComponentType.Button,
				time: COLLECTOR_TIME,
				filter: (b) => b.user.id === ctx.user.id,
				max: 1,
			});

			confirmCollector.on("collect", async (b) => {
				await b.deferUpdate();
				collector.stop("resolved");
				if (b.customId === "pledit:confirm") {
					const ok = await deletePlaylist(pl.id, ctx.user.id);
					await message.edit({
						components: [
							ok
								? successContainer()
										.addTextDisplayComponents(TextDisplay("### Deleted"))
										.addSeparatorComponents(Separator())
										.addTextDisplayComponents(TextDisplay(`-# **${pl.name}** has been deleted`))
								: errorContainer("Failed", "Could not delete playlist."),
						],
					});
				} else {
					await message.edit({ components: [buildEditor(pl)] });
				}
			});

			confirmCollector.on("end", (collected, reason) => {
				if (reason === "time" && collected.size === 0) {
					collector.stop("resolved");
					message.edit({ components: [buildConfirm(pl, true)] }).catch(() => undefined);
				}
			});
			return;
		}
	});

	collector.on("end", (_collected, reason) => {
		if (reason === "time" && !awaitingConfirm) {
			message.edit({ components: [buildEditor(pl, true)] }).catch(() => undefined);
		}
	});
}
