import { BaseStore } from "../store.js";

export interface GuildRow {
	id: string;
	default_volume: number;
	twenty_four_seven: boolean;
	twenty_four_seven_text_channel: string | null;
	twenty_four_seven_voice_channel: string | null;
	fairplay_default: boolean;
	fairplay_mod_role_id: string | null;
	autoplay_default: boolean;
	created_at: Date;
	updated_at: Date;
}

export interface Guild {
	id: string;
	defaultVolume: number;
	twentyFourSeven: boolean;
	twentyFourSevenTextChannel: string | null;
	twentyFourSevenVoiceChannel: string | null;
	fairplayDefault: boolean;
	fairplayModRoleId: string | null;
	autoplayDefault: boolean;
	createdAt: Date;
	updatedAt: Date;
}

function fromRow(row: GuildRow): Guild {
	return {
		id: row.id,
		defaultVolume: row.default_volume,
		twentyFourSeven: row.twenty_four_seven,
		twentyFourSevenTextChannel: row.twenty_four_seven_text_channel,
		twentyFourSevenVoiceChannel: row.twenty_four_seven_voice_channel,
		fairplayDefault: row.fairplay_default,
		fairplayModRoleId: row.fairplay_mod_role_id,
		autoplayDefault: row.autoplay_default,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function defaults(id: string): Guild {
	return {
		id,
		defaultVolume: 100,
		twentyFourSeven: false,
		twentyFourSevenTextChannel: null,
		twentyFourSevenVoiceChannel: null,
		fairplayDefault: false,
		fairplayModRoleId: null,
		autoplayDefault: false,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

function buildUpsert(entity: Guild): [string, unknown[]] {
	const sql = `
		INSERT INTO guilds (
			id, default_volume, twenty_four_seven, twenty_four_seven_text_channel,
			twenty_four_seven_voice_channel, fairplay_default, fairplay_mod_role_id,
			autoplay_default, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
		ON CONFLICT (id) DO UPDATE SET
			default_volume = EXCLUDED.default_volume,
			twenty_four_seven = EXCLUDED.twenty_four_seven,
			twenty_four_seven_text_channel = EXCLUDED.twenty_four_seven_text_channel,
			twenty_four_seven_voice_channel = EXCLUDED.twenty_four_seven_voice_channel,
			fairplay_default = EXCLUDED.fairplay_default,
			fairplay_mod_role_id = EXCLUDED.fairplay_mod_role_id,
			autoplay_default = EXCLUDED.autoplay_default,
			updated_at = NOW()
		RETURNING *
	`;

	const values = [
		entity.id,
		entity.defaultVolume,
		entity.twentyFourSeven,
		entity.twentyFourSevenTextChannel,
		entity.twentyFourSevenVoiceChannel,
		entity.fairplayDefault,
		entity.fairplayModRoleId,
		entity.autoplayDefault,
	];

	return [sql, values];
}

export const guildStore = new BaseStore<GuildRow, Guild, "id">({
	table: "guilds",
	keyPrefix: "guild",
	primaryKey: "id",
	fromRow,
	buildUpsert,
});

export async function ensureGuild(id: string): Promise<Guild> {
	return guildStore.getOrCreate(id, () => defaults(id));
}
export async function setTwentyFourSeven(
	id: string,
	enabled: boolean,
	channels?: { textChannelId: string; voiceChannelId: string },
): Promise<Guild> {
	const guild = await ensureGuild(id);
	return guildStore.set({
		...guild,
		twentyFourSeven: enabled,
		twentyFourSevenTextChannel: enabled
			? (channels?.textChannelId ?? guild.twentyFourSevenTextChannel)
			: guild.twentyFourSevenTextChannel,
		twentyFourSevenVoiceChannel: enabled
			? (channels?.voiceChannelId ?? guild.twentyFourSevenVoiceChannel)
			: guild.twentyFourSevenVoiceChannel,
	});
}

export const DEFAULT_VOLUME_MIN = 0;
export const DEFAULT_VOLUME_MAX = 1000;

export async function setDefaultVolume(id: string, volume: number): Promise<Guild> {
	const clamped = Math.round(Math.min(DEFAULT_VOLUME_MAX, Math.max(DEFAULT_VOLUME_MIN, volume)));
	const guild = await ensureGuild(id);
	if (guild.defaultVolume === clamped) return guild;
	return guildStore.set({ ...guild, defaultVolume: clamped });
}

export async function disableTwentyFourSeven(id: string): Promise<Guild> {
	const guild = await ensureGuild(id);
	if (!guild.twentyFourSeven) return guild;
	return guildStore.set({ ...guild, twentyFourSeven: false });
}

export async function setFairplayDefault(id: string, enabled: boolean): Promise<Guild> {
	const guild = await ensureGuild(id);
	if (guild.fairplayDefault === enabled) return guild;
	return guildStore.set({ ...guild, fairplayDefault: enabled });
}

export async function setFairplayModRole(id: string, roleId: string | null): Promise<Guild> {
	const guild = await ensureGuild(id);
	if (guild.fairplayModRoleId === roleId) return guild;
	return guildStore.set({ ...guild, fairplayModRoleId: roleId });
}

export async function setAutoplayDefault(id: string, enabled: boolean): Promise<Guild> {
	const guild = await ensureGuild(id);
	if (guild.autoplayDefault === enabled) return guild;
	return guildStore.set({ ...guild, autoplayDefault: enabled });
}
