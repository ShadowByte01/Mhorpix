import type pg from "pg";
import { logger } from "../utils/logger.js";
import { query, queryOne } from "./pg.js";
import { getRedis } from "./redis.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function dateReviver(_key: string, value: unknown): unknown {
	if (typeof value === "string" && ISO_DATE_RE.test(value)) {
		return new Date(value);
	}
	return value;
}

/**
 * Everything BaseStore needs to know about one table.
 *
 * Row    = raw Postgres row type  (snake_case, mirrors column names exactly)
 * Entity = domain object your app works with  (camelCase, computed fields ok)
 * PK     = the key of Row that is the primary key column
 *
 * Read/write contract:
 *     Call hydrate() at startup to warm the cache from PG.
 *   - PG is the ONLY write path.
 *     set() and delete() write PG first, then sync Redis.
 *   - All clusters share one Redis instance, so a write in cluster 1
 *     is immediately visible to cluster 2 — no IPC needed.
 */
export interface StoreConfig<Row extends pg.QueryResultRow, Entity, PK extends keyof Row> {
	table: string;
	keyPrefix: string;
	primaryKey: PK;

	/** Convert a raw PG row into your domain entity. */
	fromRow(row: Row): Entity;

	/**
	 * Build the upsert SQL + values array.
	 *
	 * Use ON CONFLICT (...) DO UPDATE SET ... — never DO NOTHING.
	 * DO NOTHING returns zero rows on conflict; BaseStore treats that as an error.
	 * For insert-only semantics use DO UPDATE SET <pk> = EXCLUDED.<pk> (no-op update)
	 * so RETURNING * always produces a row.
	 *
	 * Must end with RETURNING *.
	 */
	buildUpsert(entity: Entity): [sql: string, values: unknown[]];

	/**
	 * Optional SELECT override for hydrate().
	 * Defaults to `SELECT * FROM <table>`.
	 * Must return rows whose columns match Row exactly.
	 */
	hydrateQuery?: string;
}

export class BaseStore<Row extends pg.QueryResultRow, Entity, PK extends keyof Row> {
	readonly hashKey: string;
	private static _assertSafeName(name: string, label: string): void {
		if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
			throw new Error(
				`[BaseStore] Unsafe ${label} "${name}". ` +
					"Only alphanumeric characters and underscores are allowed.",
			);
		}
	}

	constructor(private readonly cfg: StoreConfig<Row, Entity, PK>) {
		BaseStore._assertSafeName(cfg.table, "table name");
		BaseStore._assertSafeName(String(cfg.primaryKey), "primary key");
		this.hashKey = `${cfg.keyPrefix}:hash`;
	}

	private field(id: Row[PK]): string {
		return String(id);
	}

	private serialize(entity: Entity): string {
		return JSON.stringify(entity);
	}

	private deserialize(raw: string): Entity {
		return JSON.parse(raw, dateReviver) as Entity;
	}

	async get(id: Row[PK]): Promise<Entity | null> {
		const raw = await getRedis().hget(this.hashKey, this.field(id));
		return raw === null ? null : this.deserialize(raw);
	}

	async has(id: Row[PK]): Promise<boolean> {
		const exists = (await getRedis().hexists(this.hashKey, this.field(id))) === 1;
		return exists;
	}

	async getMany(ids: Row[PK][]): Promise<(Entity | null)[]> {
		if (ids.length === 0) return [];
		const raws = await getRedis().hmget(this.hashKey, ...ids.map((id) => this.field(id)));
		return raws.map((raw) => (raw === null ? null : this.deserialize(raw)));
	}

	async getAll(): Promise<Entity[]> {
		const raw = await getRedis().hgetall(this.hashKey);
		if (!raw) return [];
		return Object.values(raw).map((v) => this.deserialize(v));
	}

	/** Number of cached entities without fetching any data. */
	async count(): Promise<number> {
		const n = await getRedis().hlen(this.hashKey);
		return n;
	}

	async getOrCreate(
		id: Row[PK],
		factory: Entity | (() => Entity | Promise<Entity>),
	): Promise<Entity> {
		const cached = await this.get(id);
		if (cached !== null) return cached;

		const pgRow = await queryOne<Row>(
			`SELECT * FROM ${this.cfg.table} WHERE ${String(this.cfg.primaryKey)} = $1`,
			[id],
		);
		if (pgRow !== null) {
			const entity = this.cfg.fromRow(pgRow);
			try {
				await getRedis().hset(this.hashKey, this.field(id), this.serialize(entity));
			} catch (err) {
				logger.warn(
					"DBMS",
					`[${this.cfg.table}] Redis backfill failed in getOrCreate: ${(err as Error).message}`,
				);
			}
			return entity;
		}

		const defaults =
			typeof factory === "function" ? await (factory as () => Entity | Promise<Entity>)() : factory;
		return this.set(defaults);
	}

	async set(entity: Entity): Promise<Entity> {
		const [sql, values] = this.cfg.buildUpsert(entity);
		const row = await queryOne<Row>(sql, values);
		if (!row) {
			throw new Error(
				`[${this.cfg.table}] upsert returned no row. ` +
					"Switch from ON CONFLICT DO NOTHING to DO UPDATE SET <pk> = EXCLUDED.<pk>.",
			);
		}

		const saved = this.cfg.fromRow(row);
		try {
			await getRedis().hset(
				this.hashKey,
				this.field(row[this.cfg.primaryKey]),
				this.serialize(saved),
			);
		} catch (err) {
			logger.warn(
				"DBMS",
				`[${this.cfg.table}] Redis sync failed after PG write: ${(err as Error).message}`,
			);
		}

		return saved;
	}

	async refresh(id: Row[PK]): Promise<Entity | null> {
		const pgRow = await queryOne<Row>(
			`SELECT * FROM ${this.cfg.table} WHERE ${String(this.cfg.primaryKey)} = $1`,
			[id],
		);
		if (!pgRow) {
			await this.invalidate(id);
			return null;
		}

		const entity = this.cfg.fromRow(pgRow);
		try {
			await getRedis().hset(this.hashKey, this.field(id), this.serialize(entity));
		} catch (err) {
			logger.warn(
				"DBMS",
				`[${this.cfg.table}] Redis sync failed after refresh: ${(err as Error).message}`,
			);
		}
		return entity;
	}

	async delete(id: Row[PK]): Promise<void> {
		await query(`DELETE FROM ${this.cfg.table} WHERE ${String(this.cfg.primaryKey)} = $1`, [id]);
		try {
			await getRedis().hdel(this.hashKey, this.field(id));
		} catch (err) {
			logger.warn(
				"DBMS",
				`[${this.cfg.table}] Redis eviction failed after PG delete: ${(err as Error).message}`,
			);
		}
	}

	async hydrate(): Promise<Entity[]> {
		const sql = this.cfg.hydrateQuery ?? `SELECT * FROM ${this.cfg.table}`;
		const rows = await query<Row>(sql);
		const redis = getRedis();
		const tmpKey = `${this.hashKey}:tmp:${Date.now()}`;
		const pipe = redis.pipeline();
		const entities: Entity[] = [];

		logger.info("DBMS", `[${this.cfg.table}] hydrating ${rows.length} row(s)`);

		for (const row of rows) {
			const entity = this.cfg.fromRow(row);
			entities.push(entity);
			pipe.hset(tmpKey, this.field(row[this.cfg.primaryKey]), this.serialize(entity));
		}

		if (entities.length > 0) {
			pipe.rename(tmpKey, this.hashKey);
		} else {
			pipe.del(this.hashKey);
		}

		try {
			const results = await pipe.exec();
			if (results) {
				for (const [err] of results) {
					if (err) throw err;
				}
			}
		} catch (err) {
			redis.del(tmpKey).catch(() => undefined);
			throw err;
		}

		logger.info("DBMS", `[${this.cfg.table}] hydration complete`);
		return entities;
	}

	async invalidate(id: Row[PK]): Promise<void> {
		await getRedis().hdel(this.hashKey, this.field(id));
	}

	async invalidateAll(): Promise<void> {
		await getRedis().del(this.hashKey);
	}
}
