import { spawn } from "node:child_process";
import { config } from "../../config/config.js";
import { logger } from "../logger.js";
import { MINUTES, registerCron } from "./index.js";

const DUMP_TIMEOUT_MS = 5 * 60_000;

function runPgDump(postgresUrl: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const proc = spawn("pg_dump", [
			"--dbname",
			postgresUrl,
			"--format=custom",
			"--no-owner",
			"--no-privileges",
		]);

		const chunks: Buffer[] = [];
		let stderr = "";

		const timer = setTimeout(() => {
			proc.kill("SIGKILL");
			reject(new Error("pg_dump timed out"));
		}, DUMP_TIMEOUT_MS);

		proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
		proc.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		proc.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});

		proc.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0) {
				reject(new Error(`pg_dump exited with code ${code}: ${stderr}`));
				return;
			}
			resolve(Buffer.concat(chunks));
		});
	});
}

async function sendToWebhook(webhookUrl: string, dump: Buffer, filename: string): Promise<void> {
	const form = new FormData();
	form.append("payload_json", JSON.stringify({ content: `Database backup: ${filename}` }));
	form.append("files[0]", new Blob([new Uint8Array(dump)]), filename);

	const res = await fetch(webhookUrl, { method: "POST", body: form });
	if (!res.ok) {
		throw new Error(`Webhook responded with ${res.status}: ${await res.text()}`);
	}
}

registerCron({
	name: "postgres-backup",
	intervalMs: 60 * MINUTES,
	async run() {
		if (!config.dbBackup.webhookUrl) {
			logger.warn("Cron", "postgres-backup skipped, DB_BACKUP_WEBHOOK_URL not set");
			return;
		}

		const filename = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`;

		try {
			logger.debug("Cron", "Starting postgres backup");
			const dump = await runPgDump(config.postgresUrl);
			await sendToWebhook(config.dbBackup.webhookUrl, dump, filename);
			logger.success("Cron", `Postgres backup sent (${(dump.length / 1024 / 1024).toFixed(2)} MB)`);
		} catch (err) {
			logger.error("Cron", "Postgres backup failed", err as Error);
		}
	},
});
