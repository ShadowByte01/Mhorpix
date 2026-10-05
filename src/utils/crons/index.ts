import { clearInterval, setInterval } from "node:timers";
import type { BotClient } from "../../core/BotClient.js";
import { logger } from "../logger.js";

export const MINUTES = 60_000;
export const HOURS = 60 * MINUTES;

export interface CronJob {
	readonly name: string;
	readonly intervalMs: number;
	readonly run: (client: BotClient) => Promise<void> | void;
}

const jobs: CronJob[] = [];
const timers = new Map<string, ReturnType<typeof setInterval>>();

/** Called by individual cron files (as a side effect of importing them) to register a job. */
export function registerCron(job: CronJob): void {
	jobs.push(job);
}

export async function startCrons(client: BotClient): Promise<void> {
	await import("./twentyFourSeven.js");
	await import("./cleanupPlayer.js");
	await import("./dbBackup.js");

	for (const job of jobs) {
		const run = () => {
			void Promise.resolve(job.run(client)).catch((err) => {
				logger.error("Cron", `Cron "${job.name}" failed`, err as Error);
			});
		};

		run();
		const timer = setInterval(run, job.intervalMs);
		timer.unref?.();
		timers.set(job.name, timer);
	}

	logger.success("Cron", `Started ${jobs.length} cron job(s)`);
}

export function stopCrons(): void {
	for (const timer of timers.values()) clearInterval(timer);
	timers.clear();
	jobs.length = 0;
}
