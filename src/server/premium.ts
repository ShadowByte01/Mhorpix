import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../config/config.js";
import { premiumService } from "../services/premium.js";
import { logger } from "../utils/logger.js";
import { send } from "./server.js";
import { verifyHmacSignature } from "./signature.js";

interface PremiumGrantPayload {
	type: "premium.grant";
	data: { userId: string; tier: string };
}

interface PremiumRevokePayload {
	type: "premium.revoke";
	data: { userId: string };
}

type PremiumWebhookPayload = PremiumGrantPayload | PremiumRevokePayload;

async function handlePremiumGrant(payload: PremiumGrantPayload): Promise<void> {
	const result = await premiumService.grantUserPremium(payload.data.userId, payload.data.tier);

	if (!result.success) {
		logger.warn("PremiumWebhook", `Grant failed for ${payload.data.userId}: ${result.error}`);
		return;
	}

	logger.success("PremiumWebhook", `Granted ${result.tier} premium to ${payload.data.userId}`);
}

async function handlePremiumRevoke(payload: PremiumRevokePayload): Promise<void> {
	const result = await premiumService.revokeUserPremium(payload.data.userId);

	if (!result.success) {
		logger.warn("PremiumWebhook", `Revoke failed for ${payload.data.userId}: ${result.error}`);
		return;
	}

	logger.success("PremiumWebhook", `Revoked premium (user + servers) for ${payload.data.userId}`);
}

export async function handlePremiumRequest(
	req: IncomingMessage,
	res: ServerResponse,
	rawBody: string,
): Promise<void> {
	const { webhookSecret } = config.premium;
	if (!webhookSecret) {
		logger.warn("PremiumWebhook", "PREMIUM_WEBHOOK_SECRET not set — rejecting delivery");
		send(res, 503, "Webhook not configured");
		return;
	}

	const signature = req.headers["x-premium-signature"];
	const signatureHeader = Array.isArray(signature) ? (signature[0] ?? null) : (signature ?? null);

	if (!verifyHmacSignature(rawBody, signatureHeader, webhookSecret, "PremiumWebhook")) {
		logger.warn("PremiumWebhook", "Rejected delivery: signature verification failed");
		send(res, 401, "Invalid signature");
		return;
	}

	let payload: PremiumWebhookPayload;
	try {
		payload = JSON.parse(rawBody) as PremiumWebhookPayload;
	} catch {
		send(res, 400, "Invalid JSON");
		return;
	}

	try {
		if (payload.type === "premium.grant") {
			await handlePremiumGrant(payload);
		} else if (payload.type === "premium.revoke") {
			await handlePremiumRevoke(payload);
		} else {
			logger.warn("PremiumWebhook", `Unhandled event type: ${(payload as { type: string }).type}`);
			send(res, 400, "Unknown event type");
			return;
		}
	} catch (err) {
		logger.error("PremiumWebhook", "Failed to process delivery", err as Error);
		send(res, 500, "Internal error");
		return;
	}

	send(res, 200, "OK");
}
