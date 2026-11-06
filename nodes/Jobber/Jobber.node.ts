import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { operationProperties, resourceProperty, sharedProperties } from './descriptions';
import { buildGetManyQuery, buildGetQuery, clientMutations, type ResourceKey } from './queries';
import { jobberGetMany, jobberGraphql, parseJsonParameter, readMutation } from './transport';

const readResources: ResourceKey[] = ['client', 'request', 'quote', 'job', 'invoice', 'visit'];

function isReadResource(value: string): value is ResourceKey {
	return (readResources as string[]).includes(value);
}

/**
 * Programmatic node on purpose: Jobber is GraphQL, so each operation builds a
 * query body, pages through Relay connections, and must inspect the response
 * for `errors` and `userErrors` that arrive with HTTP 200. None of that maps
 * onto declarative routing.
 */
export class Jobber implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Jobber',
		name: 'jobber',
		icon: { light: 'file:jobber.svg', dark: 'file:jobber.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Read and write clients, requests, quotes, jobs, invoices and visits in Jobber',
		defaults: { name: 'Jobber' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'jobberOAuth2Api', required: true }],
		properties: [resourceProperty, ...operationProperties, ...sharedProperties],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let output: IDataObject | IDataObject[];

				if (resource === 'graphql') {
					const query = this.getNodeParameter('query', i) as string;
					const variables = parseJsonParameter.call(
						this,
						this.getNodeParameter('variables', i, ''),
						'Variables',
						i,
					);
					output = await jobberGraphql.call(this, query, variables, i);
				} else if (resource === 'client' && operation === 'create') {
					output = await createClient.call(this, i);
				} else if (resource === 'client' && operation === 'update') {
					output = await updateClient.call(this, i);
				} else if (resource === 'client' && operation === 'archive') {
					const id = this.getNodeParameter('id', i) as string;
					const data = await jobberGraphql.call(this, clientMutations.archive, { id }, i);
					output = readMutation.call(this, data, 'clientArchive', 'client', i);
				} else if (isReadResource(resource) && operation === 'get') {
					output = await getOne.call(this, resource, i);
				} else if (isReadResource(resource) && operation === 'getMany') {
					output = await getMany.call(this, resource, i);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported for resource "${resource}"`,
						{ itemIndex: i },
					);
				}

				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(output),
					{ itemData: { item: i } },
				);
				returnData.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

async function getOne(this: IExecuteFunctions, resource: ResourceKey, i: number) {
	const id = this.getNodeParameter('id', i) as string;
	const options = this.getNodeParameter('options', i, {}) as { fields?: string };
	const query = buildGetQuery(resource, options.fields);
	const data = await jobberGraphql.call(this, query, { id }, i);
	const record = data[resource];
	if (record === null || record === undefined) {
		throw new NodeOperationError(this.getNode(), `No ${resource} found with ID "${id}"`, {
			itemIndex: i,
		});
	}
	return record as IDataObject;
}

async function getMany(this: IExecuteFunctions, resource: ResourceKey, i: number) {
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
	const searchTerm = (this.getNodeParameter('searchTerm', i, '') as string).trim();
	const options = this.getNodeParameter('options', i, {}) as {
		fields?: string;
		filter?: string | IDataObject;
	};
	const filter = parseJsonParameter.call(this, options.filter, 'Filter', i);
	const withFilter = Object.keys(filter).length > 0;
	const withSearch = searchTerm !== '';

	const query = buildGetManyQuery(resource, { withSearch, withFilter, fields: options.fields });
	const variables: IDataObject = {};
	if (withSearch) variables.searchTerm = searchTerm;
	if (withFilter) variables.filter = filter;

	const collection = `${resource}s`;
	return await jobberGetMany.call(this, query, collection, variables, { returnAll, limit }, i);
}

async function createClient(this: IExecuteFunctions, i: number) {
	const firstName = (this.getNodeParameter('firstName', i, '') as string).trim();
	const lastName = (this.getNodeParameter('lastName', i, '') as string).trim();
	const companyName = (this.getNodeParameter('companyName', i, '') as string).trim();
	const additional = this.getNodeParameter('additionalFields', i, {}) as {
		email?: string;
		phone?: string;
		extraInput?: string | IDataObject;
	};

	if (!firstName && !lastName && !companyName) {
		throw new NodeOperationError(
			this.getNode(),
			'Provide at least one of First Name, Last Name or Company Name',
			{ itemIndex: i },
		);
	}

	const input: IDataObject = {};
	if (firstName) input.firstName = firstName;
	if (lastName) input.lastName = lastName;
	if (companyName) input.companyName = companyName;
	if (additional.email?.trim()) {
		input.emails = [{ address: additional.email.trim(), primary: true }];
	}
	if (additional.phone?.trim()) {
		input.phones = [{ number: additional.phone.trim(), primary: true }];
	}
	Object.assign(input, parseJsonParameter.call(this, additional.extraInput, 'Extra Input', i));

	const data = await jobberGraphql.call(this, clientMutations.create, { input }, i);
	return readMutation.call(this, data, 'clientCreate', 'client', i);
}

async function updateClient(this: IExecuteFunctions, i: number) {
	const id = this.getNodeParameter('id', i) as string;
	const fields = this.getNodeParameter('updateFields', i, {}) as {
		firstName?: string;
		lastName?: string;
		companyName?: string;
		extraInput?: string | IDataObject;
	};
	const input: IDataObject = {};
	for (const key of ['firstName', 'lastName', 'companyName'] as const) {
		const value = fields[key];
		if (typeof value === 'string' && value.trim() !== '') input[key] = value.trim();
	}
	Object.assign(input, parseJsonParameter.call(this, fields.extraInput, 'Extra Input', i));
	if (Object.keys(input).length === 0) {
		throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
			itemIndex: i,
		});
	}
	const data = await jobberGraphql.call(this, clientMutations.update, { id, input }, i);
	return readMutation.call(this, data, 'clientEdit', 'client', i);
}
