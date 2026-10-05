import { botPermissions } from "./botPermissions.js";
import { clearCommandCooldown, cooldown } from "./cooldown.js";
import {
	fairplayBlocked,
	fairplayCurrentTrackOwnerOrMod,
	fairplayModOnly,
	fairplayModRequired,
} from "./fairplayGuard.js";
import { guildOnly } from "./guildOnly.js";
import { linkGateRequired } from "./linkGate.js";
import { ownerOnly } from "./ownerOnly.js";
import { playerChecks } from "./playerChecks.js";
import { premiumRequired } from "./premium.js";
import { sameVoiceChannel } from "./sameVoiceChannel.js";
import { userPermissions } from "./userPermissions.js";
import { voiceRequired } from "./voiceRequired.js";
import { voteRequired } from "./vote.js";
export const Middleware = {
	OwnerOnly: ownerOnly,
	GuildOnly: guildOnly,
	UserPermissions: userPermissions,
	BotPermissions: botPermissions,
	VoiceRequired: voiceRequired,
	SameVoiceChannel: sameVoiceChannel,
	Cooldown: cooldown,
	PlayerCheck: playerChecks,
	Premium: premiumRequired,
	FairplayBlocked: fairplayBlocked,
	FairplayModOnly: fairplayModOnly,
	FairplayOwnerOrMod: fairplayCurrentTrackOwnerOrMod,
	FairplayModRequired: fairplayModRequired,
	VoteRequired: voteRequired,
	LinkGate: linkGateRequired,
} as const;

export { clearCommandCooldown };
