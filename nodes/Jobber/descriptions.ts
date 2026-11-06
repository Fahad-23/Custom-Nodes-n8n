import type { INodeProperties } from 'n8n-workflow';

const readResources = ['client', 'request', 'quote', 'job', 'invoice', 'visit'];
const searchableResources = ['client', 'request', 'quote', 'job'];

export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Client', value: 'client' },
		{ name: 'GraphQL', value: 'graphql' },
		{ name: 'Invoice', value: 'invoice' },
		{ name: 'Job', value: 'job' },
		{ name: 'Quote', value: 'quote' },
		{ name: 'Request', value: 'request' },
		{ name: 'Visit', value: 'visit' },
	],
	default: 'client',
};

function readOperations(resource: string, label: string, plural: string): INodeProperties {
	return {
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [resource] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: `Get a ${label} by ID`,
				action: `Get a ${label}`,
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: `Get many ${plural}`,
				action: `Get many ${plural}`,
			},
		],
		default: 'getMany',
	};
}

export const operationProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['client'] } },
		options: [
			{
				name: 'Archive',
				value: 'archive',
				description: 'Archive a client',
				action: 'Archive a client',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Create a client',
				action: 'Create a client',
			},
			{ name: 'Get', value: 'get', description: 'Get a client by ID', action: 'Get a client' },
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get many clients',
				action: 'Get many clients',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a client',
				action: 'Update a client',
			},
		],
		default: 'getMany',
	},
	readOperations('request', 'request', 'requests'),
	readOperations('quote', 'quote', 'quotes'),
	readOperations('job', 'job', 'jobs'),
	readOperations('invoice', 'invoice', 'invoices'),
	readOperations('visit', 'visit', 'visits'),
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['graphql'] } },
		options: [
			{
				name: 'Execute',
				value: 'execute',
				description: 'Run any GraphQL query or mutation against the Jobber API',
				action: 'Run a raw query',
			},
		],
		default: 'execute',
	},
];

export const sharedProperties: INodeProperties[] = [
	// ---- Get ----
	{
		displayName: 'ID',
		name: 'id',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'Z2lkOi8vSm9iYmVyL0NsaWVudC8x',
		description:
			'The encoded Jobber ID of the record, as returned by the API or found in a webhook payload (itemId)',
		displayOptions: { show: { resource: readResources, operation: ['get', 'update', 'archive'] } },
	},
	// ---- Get Many ----
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: readResources, operation: ['getMany'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: { show: { resource: readResources, operation: ['getMany'], returnAll: [false] } },
	},
	{
		displayName: 'Search Term',
		name: 'searchTerm',
		type: 'string',
		default: '',
		description:
			'Free-text search, matched the same way the search box in Jobber works (names, emails, phone numbers, titles)',
		displayOptions: { show: { resource: searchableResources, operation: ['getMany'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show: { resource: readResources, operation: ['get', 'getMany'] } },
		options: [
			{
				displayName: 'Fields',
				name: 'fields',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				placeholder: 'name emails { address }',
				description:
					'GraphQL selection set to return instead of the default fields. Anything the Jobber schema offers for this object works here, including nested connections.',
			},
			{
				displayName: 'Filter (JSON)',
				name: 'filter',
				type: 'json',
				default: '',
				placeholder: '{ "isArchived": false }',
				description:
					'Filter object passed straight to the collection\'s "filter" argument. The accepted keys depend on the resource; see the FilterAttributes input type for it in the Jobber schema.',
				displayOptions: { show: { '/operation': ['getMany'] } },
			},
		],
	},
	// ---- Client: create ----
	{
		displayName: 'First Name',
		name: 'firstName',
		type: 'string',
		default: '',
		displayOptions: { show: { resource: ['client'], operation: ['create'] } },
	},
	{
		displayName: 'Last Name',
		name: 'lastName',
		type: 'string',
		default: '',
		displayOptions: { show: { resource: ['client'], operation: ['create'] } },
	},
	{
		displayName: 'Company Name',
		name: 'companyName',
		type: 'string',
		default: '',
		description: 'Jobber needs at least one of first name, last name or company name',
		displayOptions: { show: { resource: ['client'], operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		displayOptions: { show: { resource: ['client'], operation: ['create'] } },
		options: [
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				default: '',
				placeholder: 'name@example.com',
				description: 'Primary email address for the client',
			},
			{
				displayName: 'Phone',
				name: 'phone',
				type: 'string',
				default: '',
				description: 'Primary phone number for the client',
			},
			{
				displayName: 'Extra Input (JSON)',
				name: 'extraInput',
				type: 'json',
				default: '',
				placeholder: '{ "billingAddress": { "city": "Montréal" } }',
				description:
					'Any other ClientCreateInput fields, merged on top of the fields above. Use this for addresses, custom fields, lead source and the like.',
			},
		],
	},
	// ---- Client: update ----
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		displayOptions: { show: { resource: ['client'], operation: ['update'] } },
		options: [
			{ displayName: 'Company Name', name: 'companyName', type: 'string', default: '' },
			{ displayName: 'First Name', name: 'firstName', type: 'string', default: '' },
			{ displayName: 'Last Name', name: 'lastName', type: 'string', default: '' },
			{
				displayName: 'Extra Input (JSON)',
				name: 'extraInput',
				type: 'json',
				default: '',
				description: 'Any other ClientEditInput fields, merged on top of the fields above',
			},
		],
	},
	// ---- GraphQL ----
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		typeOptions: { rows: 8 },
		required: true,
		default: 'query { account { id name } }',
		description: 'GraphQL query or mutation. Use $variables and fill them in below.',
		displayOptions: { show: { resource: ['graphql'], operation: ['execute'] } },
	},
	{
		displayName: 'Variables (JSON)',
		name: 'variables',
		type: 'json',
		default: '',
		placeholder: '{ "first": 10 }',
		displayOptions: { show: { resource: ['graphql'], operation: ['execute'] } },
	},
];
