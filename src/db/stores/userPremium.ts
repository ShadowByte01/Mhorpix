import { BaseStore } from "../store.js";

export interface UserPremiumRow {
	id: string;
	tier: string;
	activated_at: Date | null;
	server_activations: number;
	created_at: Date;
	updated_at: Date;
}

export interface UserPremium {
	id: string;
	tier: string;
	activatedAt: Date | null;
	serverActivations: number;
	createdAt: Date;
	updatedAt: Date;
}

function fromRow(row: UserPremiumRow): UserPremium {
	return {
		id: row.id,
		tier: row.tier,
		activatedAt: row.activated_at,
		serverActivations: row.server_activations,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function buildUpsert(entity: UserPremium): [string, unknown[]] {
	const sql = `
		INSERT INTO user_premium (
			id, tier, activated_at,
			server_activations, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (id) DO UPDATE SET
			tier = EXCLUDED.tier,
			activated_at = EXCLUDED.activated_at,
			server_activations = EXCLUDED.server_activations,
			updated_at = NOW()
		RETURNING *
	`;

	const values = [
		entity.id,
		entity.tier,
		entity.activatedAt,
		entity.serverActivations,
		entity.createdAt,
	];

	return [sql, values];
}

export const userPremiumStore = new BaseStore<UserPremiumRow, UserPremium, "id">({
	table: "user_premium",
	keyPrefix: "userPremium",
	primaryKey: "id",
	fromRow,
	buildUpsert,
});
