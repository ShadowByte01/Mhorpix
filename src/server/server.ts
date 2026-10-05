import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "../config/config.js";
import { logger } from "../utils/logger.js";
import { handlePremiumRequest } from "./premium.js";
import { handleTopggRequest } from "./topgg.js";

export type WebhookRouteHandler = (
	req: IncomingMessage,
	res: ServerResponse,
	rawBody: string,
) => Promise<void>;

const routes: Record<string, WebhookRouteHandler> = {
	"/webhooks/topgg": handleTopggRequest,
	"/webhooks/premium": handlePremiumRequest,
};

export function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

export function send(res: ServerResponse, status: number, body: string): void {
	res.writeHead(status, { "Content-Type": "text/plain" });
	res.end(body);
}

export function startWebhookServer(): void {
	const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		const path = req.url?.split("?")[0];
		const handler = req.method === "POST" && path ? routes[path] : undefined;

		if (!handler) {
			send(res, 404, "Not found");
			return;
		}

		let rawBody: string;
		try {
			rawBody = await readBody(req);
		} catch (err) {
			logger.error("WebhookServer", "Failed to read request body", err as Error);
			send(res, 400, "Bad request");
			return;
		}

		await handler(req, res, rawBody);
	});

	server.listen(config.webhookPort, () => {
		logger.success("WebhookServer", `Listening on :${config.webhookPort}`);
	});
}
