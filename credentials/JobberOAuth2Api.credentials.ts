import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Jobber uses the OAuth 2.0 authorization code grant. Scopes are not sent in
 * the authorization request: they are configured on the app itself in the
 * Jobber Developer Center and shown to the user on the consent screen.
 *
 * Token endpoint expects client_id and client_secret in the form body.
 * Access tokens last 60 minutes. Refresh token rotation is on by default for
 * apps created after 2 January 2024, so the refresh token returned on every
 * refresh must replace the stored one. n8n's OAuth2 handling does that.
 *
 * Docs: https://developer.getjobber.com/docs/building_your_app/app_authorization
 */
export class JobberOAuth2Api implements ICredentialType {
	name = 'jobberOAuth2Api';

	displayName = 'Jobber OAuth2 API';

	extends = ['oAuth2Api'];

	documentationUrl = 'https://developer.getjobber.com/docs/building_your_app/app_authorization';

	icon = {
		light: 'file:../nodes/Jobber/jobber.svg',
		dark: 'file:../nodes/Jobber/jobber.dark.svg',
	} as const;

	properties: INodeProperties[] = [
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'authorizationCode',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: 'https://api.getjobber.com/api/oauth/authorize',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: 'https://api.getjobber.com/api/oauth/token',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'body',
		},
		{
			displayName: 'API Version',
			name: 'apiVersion',
			type: 'string',
			default: '2026-09-25',
			required: true,
			placeholder: 'YYYY-MM-DD',
			description:
				'Value sent in the X-JOBBER-GRAPHQL-VERSION header. Jobber versions its GraphQL API by date and supports each version for at least 12 months. Pick one from the Changelog at developer.getjobber.com/docs/changelog.',
		},
		{
			displayName:
				'Scopes are set on the app in the Jobber Developer Center, not here. The OAuth client secret is also used to verify webhook signatures in the Jobber Trigger node.',
			name: 'notice',
			type: 'notice',
			default: '',
		},
	];

	// Runs after "Connect my account": a cheap account query proves the token
	// and the API version both work. Jobber answers 401 for a bad token.
	test: ICredentialTestRequest = {
		request: {
			method: 'POST',
			url: 'https://api.getjobber.com/api/graphql',
			headers: {
				'X-JOBBER-GRAPHQL-VERSION': '={{$credentials.apiVersion}}',
				'Content-Type': 'application/json',
			},
			body: { query: 'query CredentialTest { account { id name } }' },
		},
	};
}
