import {
	type ButtonInteraction,
	ComponentType,
	GuildMember,
	type Message,
	MessageFlags,
} from "discord.js";
import type {
	Band,
	FilterOptions,
	LowPassSettings,
	RotationSettings,
	TimescaleSettings,
} from "shoukaku";
import { emoji } from "../../config/emoji.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import { defineCommand, type MusicPlayer } from "../../types/index.js";
import {
	ActionRow,
	baseSection,
	defContainer,
	errorContainer,
	Separator,
	secondaryButton,
	successButton,
	TextDisplay,
} from "../../utils/components.js";

interface FilterDef {
	equalizer: Band[];
	timescale?: TimescaleSettings;
	rotation?: RotationSettings;
	lowPass?: LowPassSettings;
}

const FILTER_NAMES = [
	"bassboost",
	"nightcore",
	"vaporwave",
	"pop",
	"rock",
	"electronic",
	"lofi",
	"trap",
	"8d",
	"soft",
	"treble",
] as const;

export type FilterName = (typeof FILTER_NAMES)[number];

const FILTERS: Record<FilterName, FilterDef> = {
	bassboost: {
		equalizer: [
			{ band: 0, gain: 0.85 },
			{ band: 1, gain: 0.75 },
			{ band: 2, gain: 0.65 },
			{ band: 3, gain: 0.45 },
			{ band: 4, gain: 0.25 },
			{ band: 5, gain: 0.0 },
			{ band: 6, gain: -0.15 },
			{ band: 7, gain: -0.15 },
			{ band: 8, gain: -0.1 },
			{ band: 9, gain: -0.05 },
			{ band: 10, gain: 0.0 },
			{ band: 11, gain: 0.0 },
			{ band: 12, gain: 0.0 },
			{ band: 13, gain: 0.0 },
		],
	},
	nightcore: {
		equalizer: [
			{ band: 0, gain: 0.15 },
			{ band: 1, gain: 0.25 },
			{ band: 2, gain: 0.35 },
			{ band: 3, gain: 0.45 },
			{ band: 4, gain: 0.55 },
			{ band: 5, gain: 0.65 },
			{ band: 6, gain: 0.75 },
			{ band: 7, gain: 0.85 },
			{ band: 8, gain: 0.75 },
			{ band: 9, gain: 0.65 },
			{ band: 10, gain: 0.55 },
			{ band: 11, gain: 0.45 },
			{ band: 12, gain: 0.35 },
			{ band: 13, gain: 0.25 },
		],
		timescale: { speed: 1.25, pitch: 1.25, rate: 1.0 },
	},
	vaporwave: {
		equalizer: [
			{ band: 0, gain: 0.5 },
			{ band: 1, gain: 0.4 },
			{ band: 2, gain: 0.3 },
			{ band: 3, gain: 0.2 },
			{ band: 4, gain: 0.0 },
			{ band: 5, gain: -0.1 },
			{ band: 6, gain: -0.2 },
			{ band: 7, gain: -0.1 },
			{ band: 8, gain: 0.0 },
			{ band: 9, gain: 0.1 },
			{ band: 10, gain: 0.1 },
			{ band: 11, gain: 0.0 },
			{ band: 12, gain: 0.0 },
			{ band: 13, gain: 0.0 },
		],
		timescale: { speed: 0.8, pitch: 0.8, rate: 1.0 },
	},
	pop: {
		equalizer: [
			{ band: 0, gain: -0.15 },
			{ band: 1, gain: 0.5 },
			{ band: 2, gain: 0.65 },
			{ band: 3, gain: 0.75 },
			{ band: 4, gain: 0.6 },
			{ band: 5, gain: 0.3 },
			{ band: 6, gain: -0.1 },
			{ band: 7, gain: -0.2 },
			{ band: 8, gain: -0.15 },
			{ band: 9, gain: -0.1 },
			{ band: 10, gain: 0.0 },
			{ band: 11, gain: 0.05 },
			{ band: 12, gain: 0.1 },
			{ band: 13, gain: 0.0 },
		],
	},
	rock: {
		equalizer: [
			{ band: 0, gain: 0.6 },
			{ band: 1, gain: 0.5 },
			{ band: 2, gain: 0.2 },
			{ band: 3, gain: 0.3 },
			{ band: 4, gain: 0.5 },
			{ band: 5, gain: 0.7 },
			{ band: 6, gain: 0.75 },
			{ band: 7, gain: 0.65 },
			{ band: 8, gain: 0.5 },
			{ band: 9, gain: 0.4 },
			{ band: 10, gain: 0.45 },
			{ band: 11, gain: 0.55 },
			{ band: 12, gain: 0.6 },
			{ band: 13, gain: 0.4 },
		],
	},
	electronic: {
		equalizer: [
			{ band: 0, gain: 0.75 },
			{ band: 1, gain: 0.65 },
			{ band: 2, gain: 0.4 },
			{ band: 3, gain: 0.2 },
			{ band: 4, gain: 0.3 },
			{ band: 5, gain: 0.5 },
			{ band: 6, gain: 0.65 },
			{ band: 7, gain: 0.8 },
			{ band: 8, gain: 0.85 },
			{ band: 9, gain: 0.7 },
			{ band: 10, gain: 0.55 },
			{ band: 11, gain: 0.45 },
			{ band: 12, gain: 0.35 },
			{ band: 13, gain: 0.25 },
		],
	},
	lofi: {
		equalizer: [
			{ band: 0, gain: 0.5 },
			{ band: 1, gain: 0.45 },
			{ band: 2, gain: 0.35 },
			{ band: 3, gain: 0.25 },
			{ band: 4, gain: 0.15 },
			{ band: 5, gain: 0.0 },
			{ band: 6, gain: -0.15 },
			{ band: 7, gain: -0.25 },
			{ band: 8, gain: -0.35 },
			{ band: 9, gain: -0.45 },
			{ band: 10, gain: -0.5 },
			{ band: 11, gain: -0.45 },
			{ band: 12, gain: -0.4 },
			{ band: 13, gain: -0.35 },
		],
		lowPass: { smoothing: 20 },
	},
	trap: {
		equalizer: [
			{ band: 0, gain: 0.8 },
			{ band: 1, gain: 0.75 },
			{ band: 2, gain: 0.55 },
			{ band: 3, gain: 0.35 },
			{ band: 4, gain: 0.1 },
			{ band: 5, gain: 0.0 },
			{ band: 6, gain: 0.15 },
			{ band: 7, gain: 0.35 },
			{ band: 8, gain: 0.55 },
			{ band: 9, gain: 0.7 },
			{ band: 10, gain: 0.8 },
			{ band: 11, gain: 0.7 },
			{ band: 12, gain: 0.55 },
			{ band: 13, gain: 0.4 },
		],
	},
	"8d": {
		equalizer: [
			{ band: 0, gain: 0.25 },
			{ band: 1, gain: 0.3 },
			{ band: 2, gain: 0.35 },
			{ band: 3, gain: 0.4 },
			{ band: 4, gain: 0.45 },
			{ band: 5, gain: 0.5 },
			{ band: 6, gain: 0.55 },
			{ band: 7, gain: 0.55 },
			{ band: 8, gain: 0.5 },
			{ band: 9, gain: 0.45 },
			{ band: 10, gain: 0.4 },
			{ band: 11, gain: 0.35 },
			{ band: 12, gain: 0.3 },
			{ band: 13, gain: 0.25 },
		],
		rotation: { rotationHz: 0.2 },
	},
	soft: {
		equalizer: [
			{ band: 0, gain: 0.2 },
			{ band: 1, gain: 0.25 },
			{ band: 2, gain: 0.3 },
			{ band: 3, gain: 0.35 },
			{ band: 4, gain: 0.4 },
			{ band: 5, gain: 0.35 },
			{ band: 6, gain: 0.25 },
			{ band: 7, gain: 0.15 },
			{ band: 8, gain: 0.0 },
			{ band: 9, gain: -0.15 },
			{ band: 10, gain: -0.2 },
			{ band: 11, gain: -0.1 },
			{ band: 12, gain: 0.0 },
			{ band: 13, gain: 0.05 },
		],
	},
	treble: {
		equalizer: [
			{ band: 0, gain: -0.2 },
			{ band: 1, gain: -0.15 },
			{ band: 2, gain: -0.1 },
			{ band: 3, gain: 0.0 },
			{ band: 4, gain: 0.1 },
			{ band: 5, gain: 0.25 },
			{ band: 6, gain: 0.4 },
			{ band: 7, gain: 0.55 },
			{ band: 8, gain: 0.7 },
			{ band: 9, gain: 0.8 },
			{ band: 10, gain: 0.85 },
			{ band: 11, gain: 0.8 },
			{ band: 12, gain: 0.7 },
			{ band: 13, gain: 0.6 },
		],
	},
};

const FILTERS_PER_PAGE = 5;

const DATA_KEYS = {
	activeFilter: "filter:active",
	updatedAt: "filter:updatedAt",
} as const;

interface CollectorState {
	page: number;
}

function getActiveFilter(player: MusicPlayer): FilterName | undefined {
	return player.data.get<FilterName>(DATA_KEYS.activeFilter);
}

function isFilterName(value: unknown): value is FilterName {
	return FILTER_NAMES.includes(value as FilterName);
}

async function applyFilter(player: MusicPlayer, name: FilterName): Promise<void> {
	const def = FILTERS[name];
	const options: FilterOptions = {
		equalizer: [...def.equalizer],
		timescale: def.timescale,
		rotation: def.rotation,
		lowPass: def.lowPass,
	};
	await player.setFilters(options);
	player.data.set<FilterName>(DATA_KEYS.activeFilter, name);
	player.data.set<number>(DATA_KEYS.updatedAt, Date.now());
}

async function clearFilter(player: MusicPlayer): Promise<void> {
	await player.clearFilters();
	player.data.del(DATA_KEYS.activeFilter);
	player.data.set<number>(DATA_KEYS.updatedAt, Date.now());
}

function capitalizeFirst(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

function pageCount(total: number): number {
	return Math.max(1, Math.ceil(total / FILTERS_PER_PAGE));
}

function buildMainMenu(player: MusicPlayer, page: number, allDisabled = false) {
	const active = getActiveFilter(player);
	const names = FILTER_NAMES as ReadonlyArray<FilterName>;
	const pages = pageCount(names.length);
	const clampedPage = Math.max(0, Math.min(page, pages - 1));
	const start = clampedPage * FILTERS_PER_PAGE;
	const end = Math.min(start + FILTERS_PER_PAGE, names.length);

	const container = defContainer();
	container.addTextDisplayComponents(TextDisplay("## Audio Filters"));
	container.addSeparatorComponents(Separator(true));

	for (let i = start; i < end; i++) {
		const name = names[i];
		if (!name) continue;
		const isActive = active === name;

		container.addSectionComponents(
			baseSection()
				.addTextDisplayComponents(
					TextDisplay(
						`**${capitalizeFirst(name)}**\n-# ${isActive ? "Currently active" : "Apply this audio filter"}`,
					),
				)
				.setButtonAccessory(
					isActive
						? successButton("Active", `filter_apply_${name}`, true)
						: secondaryButton("Apply", `filter_apply_${name}`, allDisabled),
				),
		);

		if (i < end - 1) container.addSeparatorComponents(Separator());
	}

	container.addSeparatorComponents(Separator(true));

	const navRow = ActionRow();

	if (pages > 1) {
		navRow.addComponents(
			secondaryButton("prev", `filter_prev_${clampedPage}`, allDisabled || clampedPage === 0),
			secondaryButton(
				"Next",
				`filter_next_${clampedPage}`,
				allDisabled || clampedPage >= pages - 1,
			),
		);
	}

	navRow.addComponents(
		secondaryButton("Clear All", "filter_clear", allDisabled || active === undefined),
	);

	container.addActionRowComponents(navRow);

	const activeText = active ? `Current: \`${active.toUpperCase()}\`` : "Current: None";

	container.addTextDisplayComponents(
		TextDisplay(
			`-# ${activeText}${pages > 1 ? `${emoji.get("blank")}Page ${clampedPage + 1}/${pages}` : ""}`,
		),
	);

	return container;
}

async function handleUnauthorized(interaction: ButtonInteraction): Promise<void> {
	await interaction.reply({
		components: [errorContainer("Not Authorized", "You are not authorized to do this.")],
		flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
	});
}

function resolveVoiceChannelId(interaction: ButtonInteraction): string | undefined {
	const { member } = interaction;
	if (member instanceof GuildMember) return member.voice.channelId ?? undefined;
	return undefined;
}

function isStale(player: MusicPlayer, message: Message): boolean {
	const updatedAt = player.data.get<number>(DATA_KEYS.updatedAt);
	if (updatedAt === undefined) return false;
	const messageTime = message.editedTimestamp ?? message.createdTimestamp ?? Date.now();
	return updatedAt > messageTime;
}

async function handleStale(
	interaction: ButtonInteraction,
	player: MusicPlayer,
	message: Message,
	state: CollectorState,
): Promise<void> {
	await interaction.reply({
		components: [
			defContainer().addTextDisplayComponents(
				TextDisplay("### Filter Updated\n\n-# The filter was changed since this message was sent."),
			),
		],
		flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
	});
	await message.edit({
		components: [buildMainMenu(player, state.page)],
		flags: MessageFlags.IsComponentsV2,
	});
}

async function handleButtonId(
	id: string,
	player: MusicPlayer,
	message: Message,
	state: CollectorState,
): Promise<void> {
	if (id === "filter_clear") {
		await clearFilter(player);
		await message.edit({
			components: [buildMainMenu(player, state.page)],
			flags: MessageFlags.IsComponentsV2,
		});
		return;
	}

	if (id === "filter_back") {
		await message.edit({
			components: [buildMainMenu(player, state.page)],
			flags: MessageFlags.IsComponentsV2,
		});
		return;
	}

	if (id.startsWith("filter_prev_") || id.startsWith("filter_next_")) {
		const isNext = id.startsWith("filter_next_");
		const parts = id.split("_");
		const basePage = Number.parseInt(parts[2] ?? "0", 10);
		state.page = isNext ? basePage + 1 : basePage - 1;
		await message.edit({
			components: [buildMainMenu(player, state.page)],
			flags: MessageFlags.IsComponentsV2,
		});
		return;
	}

	if (id.startsWith("filter_apply_")) {
		const name = id.slice("filter_apply_".length);
		if (!isFilterName(name)) return;
		const active = getActiveFilter(player);
		if (active) await clearFilter(player);
		await applyFilter(player, name);
		await message.edit({
			components: [buildMainMenu(player, state.page)],
			flags: MessageFlags.IsComponentsV2,
		});
	}
}

function attachCollector(ctx: CommandContext, player: MusicPlayer, message: Message): void {
	const state: CollectorState = { page: 0 };

	const collector = message.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: 300_000,
	});

	collector.on("collect", async (interaction) => {
		if (interaction.user.id !== ctx.user.id) {
			return handleUnauthorized(interaction);
		}

		const currentPlayer = ctx.client.music.getPlayer(ctx.guild.id);
		if (!currentPlayer) {
			await interaction.reply({
				components: [errorContainer("Player Inactive", "The player is no longer active.")],
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			});
			collector.stop("player_gone");
			return;
		}

		const voiceChannelId = resolveVoiceChannelId(interaction);
		if (!voiceChannelId || currentPlayer.voiceChannelId !== voiceChannelId) {
			await interaction.reply({
				components: [
					errorContainer("Wrong Voice Channel", "You must be in the same voice channel."),
				],
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			});
			return;
		}

		if (isStale(currentPlayer, message)) {
			await handleStale(interaction, currentPlayer, message, state);
			return;
		}

		await interaction.deferUpdate();
		await handleButtonId(interaction.customId, currentPlayer, message, state);
	});

	collector.on("end", (_collected, reason) => {
		if (reason === "player_gone") return;
		message
			.edit({
				components: [buildMainMenu(player, state.page, true)],
				flags: MessageFlags.IsComponentsV2,
			})
			.catch(() => {
				/** empty because errors are intentionally ignored */
			});
	});
}

export default defineCommand({
	name: "filter",
	aliases: ["eq", "equalizer", "filters"],
	description: "Apply audio filters to the music player",
	usage: "filter",
	category: "music",
	enabledSlash: true,
	slashData: {
		name: "filter",
		description: "Apply audio filters to the music player",
	},
	middleware: [
		Middleware.Cooldown(15),
		Middleware.GuildOnly(),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.FairplayBlocked("filter"),
	],
	async execute(ctx) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player) {
			await ctx.reply({
				components: [errorContainer("No Player", "There is no active player in this server.")],
				flags: MessageFlags.IsComponentsV2,
			});
			return;
		}

		const message = await ctx.reply({
			components: [buildMainMenu(player, 0)],
			flags: MessageFlags.IsComponentsV2,
		});

		attachCollector(ctx, player, message);
	},
});
