import { existsSync } from "node:fs";
import { z } from "zod";

// In Docker, env vars are injected by docker-compose's env_file directive.
// Only load the .env file when it exists on disk (local development).
if (existsSync(".env")) {
	process.loadEnvFile(".env");
}

const envSchema = z.object({
	DISCORD_TOKEN: z.string().min(1),
	DISCORD_CLIENT_ID: z.string().min(1),
	NODE_ENV: z.enum(["development", "production"]).default("development"),
	SUPPORT_LINK: z.string().min(1),
	REDIS_URL: z
		.string()
		.min(1)
		.refine((v) => v.startsWith("redis://") || v.startsWith("rediss://"), {
			message: 'Must start with "redis://" or "rediss://"',
		}),
	VOTE_ENABLED: z
		.enum(["true", "false"])
		.transform((v) => v === "true")
		.default(false),
	POSTGRES_URL: z.string().min(1).startsWith("postgres"),
	LAVALINK_HOST: z.string().min(1),
	LAVALINK_PORT: z.coerce.number().int().positive(),
	LAVALINK_AUTH: z.string().min(1),
	LAVALINK_SECURE: z
		.string()
		.transform((v) => v === "true")
		.default(false),
	LAVALINK_NODE_NAME: z.string().min(1).default("Main"),
	WEBHOOK_PORT: z.coerce.number().int().positive(),
	TOPGG_WEBHOOK_SECRET: z.string().min(1),
	PREMIUM_WEBHOOK_SECRET: z.string().min(1),
	backupWebhook: z.string().min(1),
});
export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
	const parsed = envSchema.safeParse(process.env);

	if (!parsed.success) {
		console.error("Invalid environment variables");
		console.error(z.flattenError(parsed.error));
		process.exit(1);
	}

	return parsed.data;
}

export const env = loadEnv();
