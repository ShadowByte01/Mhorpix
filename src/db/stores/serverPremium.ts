import { BaseStore } from "../store.js";

export interface ServerPremiumRow {
	id: string;
	activated_by: string;
	created_at: Date;
	updated_at: Date;
}

export interface ServerPremium {
	id: string;
	activatedBy: string;
	createdAt: Date;
	updatedAt: Date;
}

function fromRow(row: ServerPremiumRow): ServerPremium {
	return {
		id: row.id,
		activatedBy: row.activated_by,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function buildUpsert(entity: ServerPremium): [string, unknown[]] {
	const sql = `
		INSERT INTO server_premium (
			id, activated_by, created_at, updated_at
		) VALUES ($1, $2, NOW(), NOW())
		ON CONFLICT (id) DO UPDATE SET
			activated_by = EXCLUDED.activated_by,
			updated_at = NOW()
		RETURNING *
	`;

	const values = [entity.id, entity.activatedBy];

	return [sql, values];
}

export const serverPremiumStore = new BaseStore<ServerPremiumRow, ServerPremium, "id">({
	table: "server_premium",
	keyPrefix: "serverPremium",
	primaryKey: "id",
	fromRow,
	buildUpsert,
});
