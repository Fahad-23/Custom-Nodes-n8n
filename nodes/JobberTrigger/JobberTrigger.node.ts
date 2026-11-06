import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { SIGNATURE_HEADER, verifyJobberSignature } from './signature';

interface WebhookEvent {
	topic: string;
	appId?: string;
	accountId?: string;
	itemId?: string;
	occurredAt?: string;
	/** Apps created before 8 Dec 2023 receive the misspelled field. */
	occuredAt?: string;
}

function readEvent(body: IDataObject): WebhookEvent | undefined {
	const data = body.data;
	if (typeof data !== 'object' || data === null) return undefined;
	const event = (data as IDataObject).webHookEvent;
	if (typeof event !== 'object' || event === null) return undefined;
	const candidate = event as IDataObject;
	if (typeof candidate.topic !== 'string') return undefined;
	return candidate as unknown as WebhookEvent;
}

/**
 * Jobber webhooks are registered per app in the Developer Center, not through
 * the API, so this trigger cannot subscribe itself. It verifies the signature,
 * drops duplicate deliveries (Jobber is at-least-once) and emits one item per
 * event with the IDs needed to fetch the full object.
 */
export class JobberTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Jobber Trigger',
		name: 'jobberTrigger',
		icon: { light: 'file:../Jobber/jobber.svg', dark: 'file:../Jobber/jobber.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{ $parameter["topics"] || "all topics" }}',
		description: 'Starts the workflow when Jobber sends a webhook event',
		defaults: { name: 'Jobber Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'jobberOAuth2Api', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				// Jobber only needs a fast 2xx; send an empty body rather than the output item.
				responseData: 'noData',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Copy the webhook URL above into your app in the Jobber Developer Center (App settings > Webhooks), once per topic you want to receive. Jobber only sends IDs, so follow this node with a Jobber "Get" operation to load the full record.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Topics',
				name: 'topics',
				type: 'string',
				default: '',
				placeholder: 'CLIENT_CREATE, INVOICE_UPDATE',
				description:
					'Comma-separated list of topics to accept, in the OBJECT_ACTION form Jobber uses. Leave empty to pass every event this URL receives. The full list is in the Developer Center webhook form and in the WebHookTopicEnum type.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Verify Signature',
						name: 'verifySignature',
						type: 'boolean',
						default: true,
						description:
							'Whether to reject requests whose X-Jobber-Hmac-SHA256 header does not match the OAuth client secret of the selected credential',
					},
					{
						displayName: 'Ignore Duplicate Deliveries',
						name: 'deduplicate',
						type: 'boolean',
						default: true,
						description:
							'Whether to drop an event that has the same topic, item ID and timestamp as one already received inside the window below. Jobber delivers at least once, so retries are expected.',
					},
					{
						displayName: 'Duplicate Window (Seconds)',
						name: 'dedupeWindow',
						type: 'number',
						default: 120,
						typeOptions: { minValue: 1 },
						description: 'How long an event stays remembered for duplicate detection',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			// Registration happens in the Jobber Developer Center, so there is nothing
			// to create or remove on Jobber's side when the workflow is activated.
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const options = this.getNodeParameter('options', {}) as {
			verifySignature?: boolean;
			deduplicate?: boolean;
			dedupeWindow?: number;
		};

		if (options.verifySignature !== false) {
			const credentials = await this.getCredentials('jobberOAuth2Api');
			const clientSecret = typeof credentials.clientSecret === 'string' ? credentials.clientSecret : '';
			const headerValue = this.getHeaderData()[SIGNATURE_HEADER];
			const signature = Array.isArray(headerValue) ? headerValue[0] : headerValue;
			const rawBody = req.rawBody;

			if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
				res.status(500).send('Raw request body is not available, cannot verify the signature');
				return { noWebhookResponse: true };
			}
			if (!verifyJobberSignature(rawBody, signature ?? '', clientSecret)) {
				res.status(401).send('Invalid Jobber signature');
				return { noWebhookResponse: true };
			}
		}

		const body = this.getBodyData();
		const event = readEvent(body);
		if (!event) {
			res.status(400).send('Body is not a Jobber webhook payload');
			return { noWebhookResponse: true };
		}

		const topic = event.topic.toUpperCase();
		const wanted = (this.getNodeParameter('topics', '') as string)
			.split(',')
			.map((t) => t.trim().toUpperCase())
			.filter((t) => t !== '');
		if (wanted.length > 0 && !wanted.includes(topic)) {
			return { webhookResponse: 'Ignored: topic not selected' };
		}

		const occurredAt = event.occurredAt ?? event.occuredAt ?? '';
		if (options.deduplicate !== false) {
			const windowMs = Math.max(1, options.dedupeWindow ?? 120) * 1000;
			const key = `${this.getNode().id}|${topic}|${event.itemId ?? ''}|${occurredAt}`;
			if (isDuplicate(key, windowMs)) {
				return { webhookResponse: 'Ignored: duplicate delivery' };
			}
		}

		const [objectType] = topic.split('_');
		const item: IDataObject = {
			topic,
			objectType: objectType.toLowerCase(),
			itemId: event.itemId ?? null,
			accountId: event.accountId ?? null,
			appId: event.appId ?? null,
			occurredAt: occurredAt || null,
			receivedAt: new Date().toISOString(),
			payload: body,
		};

		return { workflowData: [this.helpers.returnJsonArray([item])] };
	}
}

/**
 * Recently seen event keys, kept in process memory. Workflow static data cannot
 * be relied on here: in n8n's production webhook path a write made inside
 * `webhook()` is not persisted, so duplicates after a restart would slip
 * through. A per-instance map covers the real case, which is Jobber firing the
 * same topic twice about a second apart and retrying failed deliveries. In
 * queue mode with several webhook processors, a retry that lands on another
 * processor is not caught.
 */
const recentEvents = new Map<string, number>();
const MAX_TRACKED_EVENTS = 5000;

function isDuplicate(key: string, windowMs: number): boolean {
	const now = Date.now();
	for (const [k, ts] of recentEvents) {
		if (now - ts > windowMs) recentEvents.delete(k);
	}
	if (recentEvents.has(key)) return true;
	if (recentEvents.size >= MAX_TRACKED_EVENTS) {
		const oldest = recentEvents.keys().next().value;
		if (oldest !== undefined) recentEvents.delete(oldest);
	}
	recentEvents.set(key, now);
	return false;
}
