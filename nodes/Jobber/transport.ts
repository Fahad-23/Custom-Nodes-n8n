import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

export const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';
export const DEFAULT_API_VERSION = '2026-09-25';

/** Jobber's hard cap on nodes per page. Larger values are rejected. */
export const MAX_PAGE_SIZE = 100;

const MAX_THROTTLE_RETRIES = 3;
const MAX_THROTTLE_WAIT_MS = 15_000;

type JobberContext = IExecuteFunctions | ILoadOptionsFunctions | IWebhookFunctions | IHookFunctions;

interface GraphqlError {
	message?: string;
	path?: Array<string | number>;
	extensions?: {
		code?: string;
		[key: string]: unknown;
	};
}

interface GraphqlResponse {
	data?: IDataObject | null;
	errors?: GraphqlError[];
	extensions?: {
		cost?: {
			requestedQueryCost?: number;
			actualQueryCost?: number;
			throttleStatus?: {
				maximumAvailable?: number;
				currentlyAvailable?: number;
				restoreRate?: number;
			};
		};
		versioning?: {
			version?: string;
			warning?: string;
		};
	};
}

export interface PageInfo {
	hasNextPage: boolean;
	endCursor?: string;
}

function isObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * How long to wait before retrying a THROTTLED query. Jobber restores points at
 * `restoreRate` per second, so the wait is the shortfall divided by that rate.
 */
function throttleWaitMs(response: GraphqlResponse): number {
	const cost = response.extensions?.cost;
	const requested = cost?.requestedQueryCost ?? 0;
	const available = cost?.throttleStatus?.currentlyAvailable ?? 0;
	const restoreRate = cost?.throttleStatus?.restoreRate ?? 500;
	const shortfall = Math.max(requested - available, 0);
	const seconds = restoreRate > 0 ? shortfall / restoreRate : 1;
	return Math.min(Math.ceil(seconds * 1000) + 250, MAX_THROTTLE_WAIT_MS);
}

/**
 * Run one GraphQL operation against Jobber.
 *
 * Jobber answers most failures with HTTP 200 and an `errors` array, which is why
 * the generic GraphQL node trips over it. This helper turns those into proper
 * node errors, retries cost-throttled queries after the points restore, and
 * returns only `data`.
 */
export async function jobberGraphql(
	this: JobberContext,
	query: string,
	variables: IDataObject = {},
	itemIndex = 0,
): Promise<IDataObject> {
	const credentials = await this.getCredentials('jobberOAuth2Api');
	const apiVersion =
		typeof credentials.apiVersion === 'string' && credentials.apiVersion.trim() !== ''
			? credentials.apiVersion.trim()
			: DEFAULT_API_VERSION;

	for (let attempt = 0; ; attempt++) {
		let response: unknown;
		try {
			response = await this.helpers.httpRequestWithAuthentication.call(this, 'jobberOAuth2Api', {
				method: 'POST',
				url: JOBBER_GRAPHQL_URL,
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
					'X-JOBBER-GRAPHQL-VERSION': apiVersion,
				},
				body: { query, variables },
				json: true,
			});
		} catch (error) {
			throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
		}

		if (!isObject(response)) {
			throw new NodeOperationError(this.getNode(), 'Jobber returned a response that is not JSON', {
				itemIndex,
			});
		}

		const parsed = response as GraphqlResponse;
		const errors = Array.isArray(parsed.errors) ? parsed.errors : [];

		if (errors.length > 0) {
			const throttled = errors.some((e) => e.extensions?.code === 'THROTTLED');
			if (throttled && attempt < MAX_THROTTLE_RETRIES) {
				await sleep(throttleWaitMs(parsed));
				continue;
			}

			const message = errors
				.map((e) => {
					const path = Array.isArray(e.path) && e.path.length > 0 ? ` (at ${e.path.join('.')})` : '';
					return `${e.message ?? 'Unknown GraphQL error'}${path}`;
				})
				.join('; ');

			throw new NodeApiError(
				this.getNode(),
				{ message, errors: errors as unknown as JsonObject[] },
				{
					itemIndex,
					message: throttled ? `Jobber rate limit still exceeded after retries: ${message}` : message,
					description: throttled
						? 'Reduce the page size, request fewer fields, or add a Wait node between calls.'
						: undefined,
				},
			);
		}

		if (!isObject(parsed.data)) {
			throw new NodeOperationError(this.getNode(), 'Jobber returned no data for this operation', {
				itemIndex,
			});
		}

		return parsed.data;
	}
}

/**
 * Read a Relay-style connection (`{ nodes, pageInfo }`) out of a response.
 */
export function readConnection(
	this: JobberContext,
	data: IDataObject,
	field: string,
	itemIndex = 0,
): { nodes: IDataObject[]; pageInfo: PageInfo } {
	const connection = data[field];
	if (!isObject(connection) || !Array.isArray(connection.nodes)) {
		throw new NodeOperationError(
			this.getNode(),
			`Jobber response did not contain a "${field}" collection`,
			{ itemIndex },
		);
	}
	const pageInfo = isObject(connection.pageInfo) ? connection.pageInfo : {};
	return {
		nodes: connection.nodes.filter(isObject),
		pageInfo: {
			hasNextPage: pageInfo.hasNextPage === true,
			endCursor: typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : undefined,
		},
	};
}

/**
 * Page through a collection query until `limit` items are collected or the
 * cursor runs out. `buildQuery` receives the page size and must declare
 * `$first: Int!` and `$after: String` variables.
 */
export async function jobberGetMany(
	this: JobberContext,
	query: string,
	collectionField: string,
	variables: IDataObject,
	options: { returnAll: boolean; limit: number },
	itemIndex = 0,
): Promise<IDataObject[]> {
	const results: IDataObject[] = [];
	let after: string | undefined;

	do {
		const remaining = options.returnAll ? MAX_PAGE_SIZE : options.limit - results.length;
		const first = Math.max(1, Math.min(MAX_PAGE_SIZE, remaining));
		const data = await jobberGraphql.call(this, query, { ...variables, first, after }, itemIndex);
		const page = readConnection.call(this, data, collectionField, itemIndex);
		results.push(...page.nodes);
		after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : undefined;
		if (!options.returnAll && results.length >= options.limit) break;
	} while (after);

	return options.returnAll ? results : results.slice(0, options.limit);
}

/**
 * Mutations return `{ <result>, userErrors { message path } }`. User errors are
 * validation failures and come back with HTTP 200, so surface them as errors.
 */
export function readMutation(
	this: JobberContext,
	data: IDataObject,
	mutationField: string,
	resultField: string,
	itemIndex = 0,
): IDataObject {
	const payload = data[mutationField];
	if (!isObject(payload)) {
		throw new NodeOperationError(this.getNode(), `Jobber returned no "${mutationField}" payload`, {
			itemIndex,
		});
	}
	const userErrors = Array.isArray(payload.userErrors) ? payload.userErrors.filter(isObject) : [];
	if (userErrors.length > 0) {
		const message = userErrors
			.map((e) => {
				const path = Array.isArray(e.path) && e.path.length > 0 ? ` (${e.path.join('.')})` : '';
				return `${String(e.message ?? 'Validation error')}${path}`;
			})
			.join('; ');
		throw new NodeApiError(
			this.getNode(),
			{ message, userErrors: userErrors as JsonObject[] },
			{ itemIndex, message: `Jobber rejected the ${mutationField} request: ${message}` },
		);
	}
	const result = payload[resultField];
	if (!isObject(result)) {
		throw new NodeOperationError(
			this.getNode(),
			`Jobber ${mutationField} succeeded but returned no "${resultField}"`,
			{ itemIndex },
		);
	}
	return result;
}

/** Parse a JSON parameter that may arrive as a string or an object. */
export function parseJsonParameter(
	this: JobberContext,
	value: unknown,
	parameterName: string,
	itemIndex = 0,
): IDataObject {
	if (value === undefined || value === null || value === '') return {};
	if (isObject(value)) return value;
	if (typeof value === 'string') {
		try {
			const parsed: unknown = JSON.parse(value);
			if (isObject(parsed)) return parsed;
		} catch {
			// fall through to the error below
		}
	}
	throw new NodeOperationError(this.getNode(), `"${parameterName}" must be a JSON object`, {
		itemIndex,
	});
}
