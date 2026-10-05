import { type ButtonInteraction, type GuildMember, MessageFlags } from "discord.js";
import type { BotClient } from "../../core/BotClient.js";
import { ensureGuild } from "../../db/stores/guild.js";
import { hasVotedRecently } from "../../db/stores/votes.js";
import { FAIRPLAY_MOD_PERMISSION } from "../../middlewares/fairplayGuard.js";
import { premiumService } from "../../services/premium.js";
import type { MusicPlayer } from "../../structures/music/index.js";
import { errorContainer } from "../components.js";

const VOTE_REQUIRED_MESSAGE =
	"This action requires an active vote. Vote on Top.gg and try again - \n https://top.gg/";

export async function replyError(
	interaction: ButtonInteraction,
	title: string,
	description: string,
): Promise<void> {
	await interaction
		.followUp({
			components: [errorContainer(title, description)],
			flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
		})
		.catch(() => {});
}

export async function resolvePlayerAndVoice(
	interaction: ButtonInteraction<"cached">,
	client: BotClient,
): Promise<MusicPlayer | null> {
	const player = client.music.getPlayer(interaction.guildId);
	if (!player) {
		await replyError(interaction, "No Player", "No player found for this server.");
		return null;
	}

	const voiceChannelId = interaction.member.voice.channelId;
	if (!voiceChannelId || voiceChannelId !== player.voiceChannelId) {
		await replyError(
			interaction,
			"Wrong Voice Channel",
			"You need to be in the same voice channel as the bot to do this.",
		);
		return null;
	}

	return player;
}

export async function isFairplayModMember(guildId: string, member: GuildMember): Promise<boolean> {
	if (member.permissions.has(FAIRPLAY_MOD_PERMISSION)) return true;

	const guild = await ensureGuild(guildId);
	if (!guild.fairplayModRoleId) return false;

	return member.roles.cache.has(guild.fairplayModRoleId);
}

export async function checkFairplayOwnerOrMod(
	interaction: ButtonInteraction<"cached">,
	player: MusicPlayer,
): Promise<boolean> {
	if (!player.isFairplay()) return true;
	if (await isFairplayModMember(interaction.guildId, interaction.member)) return true;

	const requesterId = player.currentTrack?.requester.id;
	if (requesterId !== undefined && requesterId === interaction.user.id) return true;

	await replyError(
		interaction,
		"Fairplay Active",
		"Only the requester of the current song, or a mod, can use this while Fairplay mode is on.",
	);
	return false;
}

export async function canUseSettings(
	guildId: string,
	member: GuildMember,
	player: MusicPlayer,
): Promise<boolean> {
	if (!player.isFairplay()) return true;
	return isFairplayModMember(guildId, member);
}

export async function hasActiveVoteOrPremium(guildId: string, userId: string): Promise<boolean> {
	const [voted, premium] = await Promise.all([
		hasVotedRecently(userId),
		premiumService.hasAnyPremium(guildId, userId),
	]);
	return voted || premium;
}

export async function checkVoteRequired(
	interaction: ButtonInteraction<"cached">,
): Promise<boolean> {
	if (await hasActiveVoteOrPremium(interaction.guildId, interaction.user.id)) return true;

	await replyError(interaction, "Vote Required", VOTE_REQUIRED_MESSAGE);
	return false;
}

export async function checkFairplayModOnly(
	interaction: ButtonInteraction<"cached">,
	player: MusicPlayer,
): Promise<boolean> {
	if (!player.isFairplay()) return true;
	if (await isFairplayModMember(interaction.guildId, interaction.member)) return true;

	await replyError(
		interaction,
		"Fairplay Active",
		"You need Mute Members, or the Fairplay Mod role, to do this while Fairplay mode is on.",
	);
	return false;
}
