import { config } from "../../config/config.js";
import { BaseStore } from "../store.js";

export interface UserVoteRow {
	id: string;
	topgg_user_id: string | null;
	last_vote_id: string | null;
	last_voted_at: Date | null;
	expires_at: Date | null;
	last_weight: number;
	vote_count: number;
	created_at: Date;
	updated_at: Date;
}

export interface UserVote {
	id: string;
	topggUserId: string | null;
	lastVoteId: string | null;
	lastVotedAt: Date | null;
	expiresAt: Date | null;
	lastWeight: number;
	voteCount: number;
	createdAt: Date;
	updatedAt: Date;
}

function fromRow(row: UserVoteRow): UserVote {
	return {
		id: row.id,
		topggUserId: row.topgg_user_id,
		lastVoteId: row.last_vote_id,
		lastVotedAt: row.last_voted_at,
		expiresAt: row.expires_at,
		lastWeight: row.last_weight,
		voteCount: row.vote_count,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function defaults(id: string): UserVote {
	return {
		id,
		topggUserId: null,
		lastVoteId: null,
		lastVotedAt: null,
		expiresAt: null,
		lastWeight: 1,
		voteCount: 0,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

function buildUpsert(entity: UserVote): [string, unknown[]] {
	const sql = `
		INSERT INTO user_votes (
			id, topgg_user_id, last_vote_id, last_voted_at,
			expires_at, last_weight, vote_count, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
		ON CONFLICT (id) DO UPDATE SET
			topgg_user_id = EXCLUDED.topgg_user_id,
			last_vote_id = EXCLUDED.last_vote_id,
			last_voted_at = EXCLUDED.last_voted_at,
			expires_at = EXCLUDED.expires_at,
			last_weight = EXCLUDED.last_weight,
			vote_count = EXCLUDED.vote_count,
			updated_at = NOW()
		RETURNING *
	`;

	const values = [
		entity.id,
		entity.topggUserId,
		entity.lastVoteId,
		entity.lastVotedAt,
		entity.expiresAt,
		entity.lastWeight,
		entity.voteCount,
	];

	return [sql, values];
}

export const userVoteStore = new BaseStore<UserVoteRow, UserVote, "id">({
	table: "user_votes",
	keyPrefix: "userVote",
	primaryKey: "id",
	fromRow,
	buildUpsert,
});

export async function ensureUserVote(id: string): Promise<UserVote> {
	return userVoteStore.getOrCreate(id, () => defaults(id));
}

export interface RecordVoteInput {
	readonly discordUserId: string;
	readonly topggUserId: string;
	readonly voteId: string;
	readonly weight: number;
	readonly votedAt: Date;
	readonly expiresAt: Date;
}

export async function recordVote(input: RecordVoteInput): Promise<UserVote> {
	const existing = await ensureUserVote(input.discordUserId);

	if (existing.lastVoteId === input.voteId) {
		return existing;
	}

	return userVoteStore.set({
		...existing,
		topggUserId: input.topggUserId,
		lastVoteId: input.voteId,
		lastVotedAt: input.votedAt,
		expiresAt: input.expiresAt,
		lastWeight: input.weight,
		voteCount: existing.voteCount + 1,
	});
}

export async function hasVotedRecently(discordUserId: string): Promise<boolean> {
	const vote = await userVoteStore.get(discordUserId);
	if (!config.voteEnabled) return true;
	if (!vote?.expiresAt) return false;
	return vote.expiresAt.getTime() > Date.now();
}

export async function getVoteStatus(discordUserId: string): Promise<{
	readonly hasVoted: boolean;
	readonly lastVotedAt: Date | null;
	readonly expiresAt: Date | null;
	readonly voteCount: number;
}> {
	const vote = await userVoteStore.get(discordUserId);
	if (!config.voteEnabled)
		return {
			hasVoted: true,
			lastVotedAt: null,
			expiresAt: null,
			voteCount: 0,
		};
	const hasVoted = vote?.expiresAt != null && vote.expiresAt.getTime() > Date.now();
	return {
		hasVoted,
		lastVotedAt: vote?.lastVotedAt ?? null,
		expiresAt: vote?.expiresAt ?? null,
		voteCount: vote?.voteCount ?? 0,
	};
}
