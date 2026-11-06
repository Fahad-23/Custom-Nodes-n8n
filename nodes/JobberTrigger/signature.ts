import { createHmac, timingSafeEqual } from 'crypto';

export const SIGNATURE_HEADER = 'x-jobber-hmac-sha256';

/**
 * Jobber signs every webhook with HMAC-SHA256 over the raw request body, keyed
 * with the app's OAuth client secret, and sends it base64-encoded in the
 * X-Jobber-Hmac-SHA256 header.
 * Docs: https://developer.getjobber.com/docs/using_jobbers_api/setting_up_webhooks
 */
export function verifyJobberSignature(rawBody: Buffer, header: string, clientSecret: string): boolean {
	if (!header || !clientSecret) return false;
	const expected = Buffer.from(createHmac('sha256', clientSecret).update(rawBody).digest('base64'));
	const received = Buffer.from(header.trim());
	if (expected.length !== received.length) return false;
	return timingSafeEqual(expected, received);
}

export function signJobberPayload(rawBody: Buffer | string, clientSecret: string): string {
	return createHmac('sha256', clientSecret).update(rawBody).digest('base64');
}
