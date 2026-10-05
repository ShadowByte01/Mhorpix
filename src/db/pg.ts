import pg from "pg";
import { config } from "../config/config.js";
import { logger } from "../utils/logger.js";

const { Pool } = pg;

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
	if (_pool) return _pool;

	const url = config.postgresUrl;
	if (!url) throw new Error("DATABASE_URL is not set");

	_pool = new Pool({
		connectionString: url,
		max: 5,
		connectionTimeoutMillis: 5_000,
		idleTimeoutMillis: 30_000,
		application_name: `bot-cluster-${process.pid}`,
	});

	_pool.on("error", (err) => logger.error("POSTGRES", "error", err));

	return _pool;
}

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
	sql: string,
	values?: unknown[],
): Promise<R[]> {
	const { rows } = await getPool().query<R>(sql, values);
	return rows;
}

export async function queryOne<R extends pg.QueryResultRow = pg.QueryResultRow>(
	sql: string,
	values?: unknown[],
): Promise<R | null> {
	const rows = await query<R>(sql, values);
	return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
	const client = await getPool().connect();
	try {
		await client.query("BEGIN");
		const result = await fn(client);
		await client.query("COMMIT");
		return result;
	} catch (err) {
		await client.query("ROLLBACK").catch(() => undefined);
		throw err;
	} finally {
		client.release();
	}
}

export async function closePool(): Promise<void> {
	if (!_pool) return;
	await _pool.end();
	_pool = null;
	logger.info("POSTGRES", "connection closed");
}
