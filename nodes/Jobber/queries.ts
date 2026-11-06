/**
 * GraphQL selection sets and query builders.
 *
 * Jobber charges query cost per field, so the default selections stay lean.
 * Every operation exposes a "Fields" option that replaces the selection set,
 * so users can pull whatever the schema offers without waiting for a release.
 */

export type ResourceKey = 'client' | 'request' | 'quote' | 'job' | 'invoice' | 'visit';

interface ResourceDefinition {
	single: string;
	collection: string;
	filterType?: string;
	supportsSearch: boolean;
	listFields: string;
	detailFields: string;
}

const address = 'street1 street2 city province postalCode country';

export const resources: Record<ResourceKey, ResourceDefinition> = {
	client: {
		single: 'client',
		collection: 'clients',
		filterType: 'ClientFilterAttributes',
		supportsSearch: true,
		listFields:
			'id name firstName lastName companyName isCompany isLead isArchived jobberWebUri createdAt updatedAt',
		detailFields: `id name title firstName lastName companyName isCompany isLead isArchived jobberWebUri createdAt updatedAt
			emails { id address description primary }
			phones { id number description primary smsAllowed }
			billingAddress { ${address} }`,
	},
	request: {
		single: 'request',
		collection: 'requests',
		filterType: 'RequestFilterAttributes',
		supportsSearch: true,
		listFields:
			'id title requestStatus source contactName companyName email phone jobberWebUri createdAt updatedAt client { id name } property { id name }',
		detailFields: `id title requestStatus source contactName companyName email phone isScheduled jobberWebUri createdAt updatedAt
			client { id name } property { id name address { ${address} } }
			assessment { id title startAt endAt allDay isComplete }`,
	},
	quote: {
		single: 'quote',
		collection: 'quotes',
		filterType: 'QuoteFilterAttributes',
		supportsSearch: true,
		listFields:
			'id quoteNumber title quoteStatus jobberWebUri createdAt updatedAt sentAt client { id name } amounts { subtotal taxAmount total }',
		detailFields: `id quoteNumber title message quoteStatus jobberWebUri createdAt updatedAt sentAt transitionedAt
			client { id name } property { id name address { ${address} } } request { id title }
			amounts { depositAmount discountAmount subtotal taxAmount total }
			lineItems(first: 100) { nodes { id name description quantity unitPrice totalPrice taxable optional } pageInfo { hasNextPage endCursor } }`,
	},
	job: {
		single: 'job',
		collection: 'jobs',
		filterType: 'JobFilterAttributes',
		supportsSearch: true,
		listFields:
			'id jobNumber title jobStatus jobType jobberWebUri startAt endAt completedAt total createdAt updatedAt client { id name }',
		detailFields: `id jobNumber title instructions jobStatus jobType jobberWebUri startAt endAt completedAt total invoicedTotal uninvoicedTotal createdAt updatedAt
			client { id name } property { id name address { ${address} } }
			visitsInfo { scheduledCount unscheduledCount incompleteTotal futureCount pastCount }`,
	},
	invoice: {
		single: 'invoice',
		collection: 'invoices',
		filterType: 'InvoiceFilterAttributes',
		supportsSearch: false,
		listFields:
			'id invoiceNumber subject invoiceStatus jobberWebUri issuedDate dueDate createdAt updatedAt client { id name } amounts { total invoiceBalance }',
		detailFields: `id invoiceNumber subject message invoiceStatus jobberWebUri issuedDate dueDate receivedDate createdAt updatedAt
			client { id name } billingAddress { ${address} }
			amounts { subtotal taxAmount discountAmount depositAmount paymentsTotal invoiceBalance total }`,
	},
	visit: {
		single: 'visit',
		collection: 'visits',
		filterType: 'VisitFilterAttributes',
		supportsSearch: false,
		listFields:
			'id title visitStatus startAt endAt allDay isComplete completedAt createdAt client { id name } property { id name } job { id jobNumber title }',
		detailFields: `id title instructions visitStatus startAt endAt allDay duration isComplete completedAt clientConfirmed createdAt
			client { id name } property { id name address { ${address} } } job { id jobNumber title }
			assignedUsers(first: 50) { nodes { id name { full } } }`,
	},
};

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function buildGetQuery(resource: ResourceKey, fields?: string): string {
	const definition = resources[resource];
	const selection = fields?.trim() || definition.detailFields;
	return `query Get${capitalize(resource)}($id: EncodedId!) { ${definition.single}(id: $id) { ${selection} } }`;
}

export function buildGetManyQuery(
	resource: ResourceKey,
	options: { withSearch: boolean; withFilter: boolean; fields?: string },
): string {
	const definition = resources[resource];
	const selection = options.fields?.trim() || definition.listFields;
	const variableDefs = ['$first: Int!', '$after: String'];
	const args = ['first: $first', 'after: $after'];
	if (options.withSearch && definition.supportsSearch) {
		variableDefs.push('$searchTerm: String');
		args.push('searchTerm: $searchTerm');
	}
	if (options.withFilter && definition.filterType) {
		variableDefs.push(`$filter: ${definition.filterType}`);
		args.push('filter: $filter');
	}
	return `query GetMany${capitalize(resource)}(${variableDefs.join(', ')}) {
		${definition.collection}(${args.join(', ')}) {
			nodes { ${selection} }
			pageInfo { hasNextPage endCursor }
		}
	}`;
}

const clientMutationFields = `client { ${resources.client.detailFields} } userErrors { message path }`;

export const clientMutations = {
	create: `mutation ClientCreate($input: ClientCreateInput!) { clientCreate(input: $input) { ${clientMutationFields} } }`,
	update: `mutation ClientEdit($id: EncodedId!, $input: ClientEditInput!) { clientEdit(clientId: $id, input: $input) { ${clientMutationFields} } }`,
	archive: `mutation ClientArchive($id: EncodedId!) { clientArchive(clientId: $id) { ${clientMutationFields} } }`,
};

export const accountQuery = 'query Account { account { id name industry countryCode phone createdAt } }';
