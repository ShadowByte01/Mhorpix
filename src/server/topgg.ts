import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../config/config.js";
import { recordVote } from "../db/stores/votes.js";
import { logger } from "../utils/logger.js";
import { send } from "./server.js";
import { verifyHmacSignature } from "./signature.js";

interface VoteCreatePayload {
	type: "vote.create";
	data: {
		id: string;
		weight: number;
		created_at: string;
		expires_at: string;
		project: { id: string; type: string; platform: string; platform_id: string };
		query?: Record<string, string>;
		user: { id: string; platform_id: string; name: string; avatar_url: string };
	};
}

interface WebhookTestPayload {
	type: "webhook.test";
	data: {
		user: { id: string; platform_id: string; name: string; avatar_url: string };
		project: { id: string; type: string; platform: string; platform_id: string };
	};
}

type TopggPayload = VoteCreatePayload | WebhookTestPayload;

async function handleVoteCreate(payload: VoteCreatePayload): Promise<void> {
	const { id, weight, created_at, expires_at, user } = payload.data;

	const saved = await recordVote({
		discordUserId: user.platform_id,
		topggUserId: user.id,
		voteId: id,
		weight,
		votedAt: new Date(created_at),
		expiresAt: new Date(expires_at),
	});

	logger.success(
		"TopggWebhook",
		`Recorded vote ${id} for ${user.platform_id} (weight ${weight}, total ${saved.voteCount})`,
	);
}

export async function handleTopggRequest(
	req: IncomingMessage,
	res: ServerResponse,
	rawBody: string,
): Promise<void> {
	const { webhookSecret } = config.topgg;
	if (!webhookSecret) {
		logger.warn("TopggWebhook", "TOPGG_WEBHOOK_SECRET not set — rejecting delivery");
		send(res, 503, "Webhook not configured");
		return;
	}

	const signature = req.headers["x-topgg-signature"];
	const signatureHeader = Array.isArray(signature) ? (signature[0] ?? null) : (signature ?? null);

	if (!verifyHmacSignature(rawBody, signatureHeader, webhookSecret, "TopggWebhook")) {
		logger.warn("TopggWebhook", "Rejected delivery: signature verification failed");
		send(res, 401, "Invalid signature");
		return;
	}

	let payload: TopggPayload;
	try {
		payload = JSON.parse(rawBody) as TopggPayload;
	} catch {
		send(res, 400, "Invalid JSON");
		return;
	}

	try {
		if (payload.type === "vote.create") {
			await handleVoteCreate(payload);
		} else if (payload.type === "webhook.test") {
			logger.info(
				"TopggWebhook",
				`Received webhook.test from ${payload.data.user.name} (${payload.data.user.platform_id})`,
			);
		} else {
			logger.warn("TopggWebhook", `Unhandled event type: ${(payload as { type: string }).type}`);
		}
	} catch (err) {
		logger.error("TopggWebhook", "Failed to process delivery", err as Error);
		send(res, 500, "Internal error");
		return;
	}

	send(res, 200, "OK");
}
