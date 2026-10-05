import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { isFairplayMod } from "../../middlewares/fairplayGuard.js";
import { Middleware } from "../../middlewares/index.js";
import type { CommandContext } from "../../structures/context/index.js";
import type { QueueTrack } from "../../types/index.js";
import { defineCommand, LoopMode } from "../../types/index.js";
import { defContainer, errorContainer, TextDisplay } from "../../utils/components.js";

function levenshtein(a: string, b: string): number {
	const lengthA = a.length;
	const lengthB = b.length;
	if (lengthA === 0) return lengthB;
	if (lengthB === 0) return lengthA;

	const dp = new Array<number>(lengthB + 1);
	for (let j = 0; j <= lengthB; j++) dp[j] = j;

	for (let i = 1; i <= lengthA; i++) {
		let prev = dp[0] as number;
		dp[0] = i;
		for (let j = 1; j <= lengthB; j++) {
			const temp = dp[j] as number;
			dp[j] =
				a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j] as number, dp[j - 1] as number);
			prev = temp;
		}
	}
	return dp[lengthB] as number;
}

function windowDistance(query: string, target: string, start: number): number {
	const qLen = query.length;
	let best = Number.POSITIVE_INFINITY;
	for (let len = Math.max(1, qLen - 2); len <= qLen + 2; len++) {
		if (start + len > target.length) continue;
		const dist = levenshtein(query, target.slice(start, start + len));
		if (dist < best) best = dist;
	}
	return best;
}

function closestSubstringDistance(query: string, target: string): number {
	if (target.includes(query)) return 0;

	let best = Number.POSITIVE_INFINITY;
	for (let start = 0; start < target.length; start++) {
		const dist = windowDistance(query, target, start);
		if (dist < best) best = dist;
		if (best === 0) return 0;
	}
	return best;
}

function findClosestTrack(query: string, tracks: readonly QueueTrack[]): QueueTrack | undefined {
	const normalizedQuery = query.toLowerCase().trim();
	if (!normalizedQuery) return undefined;

	let bestTrack: QueueTrack | undefined;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const track of tracks) {
		const dist = closestSubstringDistance(normalizedQuery, track.info.title.toLowerCase());
		if (dist < bestDist) {
			bestDist = dist;
			bestTrack = track;
		}
	}

	const maxAllowed = Math.max(2, Math.ceil(normalizedQuery.length * 0.4));
	return bestTrack && bestDist <= maxAllowed ? bestTrack : undefined;
}

async function replySkipError(
	ctx: CommandContext,
	title: string,
	description: string,
): Promise<void> {
	await ctx.reply({
		components: [errorContainer(title, description)],
		flags: MessageFlags.IsComponentsV2,
	});
}

function parsePrefixSkipInput(args: string[]): { count?: number; nameQuery?: string } {
	const raw = args.join(" ").trim();
	const asInt = Number.parseInt(args[0] ?? "", 10);
	if (args[0] !== undefined && String(asInt) === args[0]) return { count: asInt };
	return { nameQuery: raw.length > 0 ? raw : undefined };
}

function parseSkipInput(ctx: CommandContext): { count?: number; nameQuery?: string } {
	if (!ctx.isSlash()) return parsePrefixSkipInput(ctx.args);
	return {
		count: ctx.options.getInteger("count", false) ?? undefined,
		nameQuery: ctx.options.getString("name", false)?.trim() || undefined,
	};
}

function resolveCountFromName(
	nameQuery: string,
	tracks: readonly QueueTrack[],
): { count?: number; matchedTitle?: string } {
	const match = findClosestTrack(nameQuery, tracks);
	if (!match) return {};
	return { count: tracks.indexOf(match) + 1, matchedTitle: match.info.title };
}

function buildSkipLabel(count: number, matchedTitle?: string): string {
	const suffix = count > 1 ? "s" : "";
	return matchedTitle
		? `-# Skipped \`${count}\` song${suffix} to reach **${matchedTitle}**.`
		: `-# Skipped \`${count}\` song${suffix}.`;
}

function maxFairplaySkippable(
	ctx: CommandContext,
	player: { queue: { toArray(): readonly QueueTrack[] } },
): number {
	const upcoming = player.queue.toArray();
	let max = 1;
	for (const track of upcoming) {
		if (track.requester.id !== ctx.user.id) break;
		max++;
	}
	return max;
}

export default defineCommand({
	name: "skip",
	aliases: ["s"],
	description: "Skip the current song, a number of songs, or skip to a song by name",
	category: "music",
	usage: "skip [number | name]",
	slashUsage: "skip [number | name]",
	enabledSlash: true,
	middleware: [
		Middleware.Cooldown(10),
		Middleware.VoiceRequired(),
		Middleware.SameVoiceChannel(),
		Middleware.PlayerCheck("playing"),
		Middleware.FairplayOwnerOrMod(),
	],
	slashData: {
		name: "skip",
		description: "Skip the current song, a number of songs, or skip to a song by name",
		options: [
			{
				type: ApplicationCommandOptionType.Integer,
				name: "count",
				description: "Number of songs to skip",
				min_value: 1,
				required: false,
				autocomplete: false,
			},
			{
				type: ApplicationCommandOptionType.String,
				name: "name",
				description: "Skip forward to the song matching this name",
				required: false,
				autocomplete: false,
			},
		],
	},
	async execute(ctx) {
		const player = ctx.client.music.getPlayer(ctx.guild.id);
		if (!player) return;

		if (player.queue.size === 0) {
			await replySkipError(ctx, "No Song", "There is no song in the queue.");
			return;
		}
		if (player.getLoop() === LoopMode.Track) {
			await replySkipError(
				ctx,
				"Loop Mode",
				"The loop mode is set to track, you can't skip to a specific song.",
			);
			return;
		}

		const { count: parsedCount, nameQuery } = parseSkipInput(ctx);
		let count = parsedCount;
		let matchedTitle: string | undefined;

		if (nameQuery) {
			const resolved = resolveCountFromName(nameQuery, player.queue.toArray());
			if (resolved.count === undefined) {
				await replySkipError(
					ctx,
					"Not Found",
					`No song matching "${nameQuery}" found in the queue.`,
				);
				return;
			}
			count = resolved.count;
			matchedTitle = resolved.matchedTitle;
		}

		count ??= 1;

		if (!Number.isInteger(count) || count < 1 || count > player.queue.size) {
			await replySkipError(
				ctx,
				"Invalid Count",
				`Count must be a whole number between 1 and ${player.queue.size}.`,
			);
			return;
		}

		if (player.isFairplay() && count > 1 && !isFairplayMod(ctx)) {
			const maxAllowed = maxFairplaySkippable(ctx, player);
			if (count > maxAllowed) {
				await replySkipError(
					ctx,
					"Fairplay Active",
					maxAllowed > 1
						? `Fairplay mode is on — you can only skip up to \`${maxAllowed}\` song(s) ahead before reaching one you didn't request. A mod can skip further.`
						: "Fairplay mode is on — skipping ahead would remove songs requested by other people. You can still skip just the current song, or a mod can skip further.",
				);
				return;
			}
		}

		await player.skip(count);

		// const suffix = count > 1 ? "s" : "";
		await ctx.reply({
			components: [
				defContainer().addTextDisplayComponents(
					TextDisplay([buildSkipLabel(count, matchedTitle)].join("\n")),
				),
			],
			flags: MessageFlags.IsComponentsV2,
		});
	},
});
