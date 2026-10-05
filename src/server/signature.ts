import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../utils/logger.js";

const MAX_TIMESTAMP_SKEW_MS = 5 * 60_000;

export function verifyHmacSignature(
	rawBody: string,
	signatureHeader: string | null,
	secret: string,
	source: string,
): boolean {
	if (!signatureHeader) return false;

	const parts = Object.fromEntries(
		signatureHeader.split(",").map((p) => {
			const [k, v] = p.split("=");
			return [k, v] as const;
		}),
	);
	const timestamp = parts.t;
	const receivedSig = parts.v1;
	if (!timestamp || !receivedSig) return false;

	const ts = Number(timestamp);
	if (!Number.isFinite(ts) || Math.abs(Date.now() - ts * 1000) > MAX_TIMESTAMP_SKEW_MS) {
		logger.warn(source, "Rejected delivery: timestamp outside allowed skew");
		return false;
	}

	const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

	const expectedBuf = Buffer.from(expected, "hex");
	const receivedBuf = Buffer.from(receivedSig, "hex");
	if (expectedBuf.length !== receivedBuf.length) return false;

	return timingSafeEqual(expectedBuf, receivedBuf);
}
