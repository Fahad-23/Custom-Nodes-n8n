# n8n-nodes-jobber

An [n8n](https://n8n.io) community node for [Jobber](https://getjobber.com), the field service platform used by home service businesses.

It gives you two nodes:

- **Jobber**: read and write clients, requests, quotes, jobs, invoices and visits, or run any GraphQL query or mutation against the Jobber API.
- **Jobber Trigger**: start a workflow when Jobber sends a webhook event, with signature verification and duplicate filtering built in.

## Why not the generic GraphQL node?

You can call Jobber from n8n's HTTP Request or GraphQL node. People do, and then hit the same problems:

- Jobber answers most failures with HTTP 200 and an `errors` array, so a broken call looks like a success.
- Rate limiting is cost-based (10,000 points per app and account, restored at 500 points per second). A throttled query comes back as `THROTTLED` inside `errors`, not as a 429.
- Pagination is cursor based. "Get everything" means looping on `pageInfo.endCursor` yourself.
- Mutations put validation failures in `userErrors`, again with HTTP 200.
- Webhooks are signed with HMAC-SHA256 over the raw body and delivered at least once, so you have to verify and deduplicate.

This node handles all of that. Throttled queries wait for the points to restore and retry. GraphQL errors and `userErrors` become node errors with the message and path. "Get Many" pages through the whole collection or stops at your limit.

## Installation

In n8n go to **Settings > Community Nodes > Install** and enter `n8n-nodes-jobber`.

Self-hosted without the UI installer:

```bash
cd ~/.n8n/nodes
npm install n8n-nodes-jobber
```

Then restart n8n.

## Setting up credentials

Jobber only supports OAuth 2.0, so you need an app in the [Jobber Developer Center](https://developer.getjobber.com/).

1. Sign up for a developer account and create an app. Draft apps can be connected to up to five paying Jobber accounts without going through App Review, which covers private integrations.
2. In n8n, add a **Jobber OAuth2 API** credential and copy its **OAuth Redirect URL**.
3. Back in the Developer Center, paste that URL as the app's **OAuth Callback URL** and pick the **scopes** you need (for example `read_clients`, `write_clients`, `read_jobs`). Scopes live on the app, not in n8n.
4. Copy the app's **Client ID** and **Client Secret** into the n8n credential and click **Connect my account**.

The credential also has an **API Version** field. Jobber versions its GraphQL API by date and supports each version for at least 12 months. The default is a recent version from the [changelog](https://developer.getjobber.com/docs/changelog); change it when you want to pick up newer schema fields.

Refresh token rotation is on by default for Jobber apps. n8n stores the new refresh token after every refresh, so leave rotation enabled.

## Jobber node

| Resource | Operations |
|---|---|
| Client | Create, Get, Get Many, Update, Archive |
| Request | Get, Get Many |
| Quote | Get, Get Many |
| Job | Get, Get Many |
| Invoice | Get, Get Many |
| Visit | Get, Get Many |
| GraphQL | Execute (any query or mutation, with variables) |

**Get Many** supports **Return All** or a **Limit**, a free-text **Search Term** where Jobber offers one (clients, requests, quotes, jobs), and a **Filter (JSON)** option that is passed straight to the collection's `filter` argument.

Every Get and Get Many has a **Fields** option. Paste a GraphQL selection set there and it replaces the default fields, so you can pull custom fields, line items or nested connections without waiting for a new release of this package. The defaults are kept lean on purpose, because Jobber charges query cost per field.

**Client > Create** takes first name, last name, company name, a primary email and phone, and an **Extra Input (JSON)** field for anything else in `ClientCreateInput` (billing address, lead source, custom fields). **Update** works the same way with `ClientEditInput`.

For anything the resource operations do not cover, use **GraphQL > Execute**. It goes through the same transport, so you still get throttle retries and error handling.

### Example: find a client by phone and update them

1. Jobber node, Client > Get Many, Search Term `+1 514 555 0100`, Limit 1.
2. Jobber node, Client > Update, ID `{{ $json.id }}`, Extra Input `{ "leadSource": "Voice agent" }`.

## Jobber Trigger

Jobber registers webhooks per app in the Developer Center, not through the API, so the trigger cannot subscribe itself:

1. Add a **Jobber Trigger** node and copy its webhook URL.
2. In the Developer Center open your app, go to **Webhooks**, and add one entry per topic (`CLIENT_CREATE`, `JOB_UPDATE`, and so on) pointing at that URL. Your app needs the matching read scope for each topic.
3. Optionally list the topics in the node's **Topics** field so a shared URL only fires this workflow for the events you care about.

What the trigger does on every request:

- Verifies the `X-Jobber-Hmac-SHA256` header against the OAuth client secret of the selected credential, and answers 401 if it does not match. You can switch this off in **Options**, but do not.
- Drops duplicate deliveries. Jobber delivers at least once and some actions fire the same topic twice within a second. Events with the same topic, item ID and timestamp are ignored inside a configurable window (120 seconds by default). The memory for this lives in the n8n process, so in queue mode with several webhook processors a retry that lands on a different processor is not caught.
- Responds immediately. Jobber expects an answer within one second and may disable your app's webhooks if it keeps waiting.

The output item looks like this:

```json
{
  "topic": "CLIENT_CREATE",
  "objectType": "client",
  "itemId": "MQ==",
  "accountId": "MQ==",
  "appId": "3ef22a50-072d-430c-a78f-b7646657560b",
  "occurredAt": "2026-07-16T16:31:31-06:00",
  "receivedAt": "2026-07-16T22:31:32.118Z",
  "payload": { "data": { "webHookEvent": { "...": "..." } } }
}
```

Jobber webhooks carry IDs only. Follow the trigger with a **Jobber** node, resource matching `objectType`, operation **Get**, ID `{{ $json.itemId }}` to load the record.

## Rate limits

Every call carries a query cost. When Jobber reports `THROTTLED`, the node reads `throttleStatus` from the response, waits for the points to restore (capped at 15 seconds), and retries up to three times. If it is still throttled it fails with a clear message. Smaller pages and fewer fields are the fix.

## Compatibility

Built and linted with `@n8n/node-cli`, no runtime dependencies, tested against n8n 2.x. Node.js 20.15 or newer.

## Status

Version 0.1.0. The OAuth flow, request transport, pagination, mutation handling and webhook signature check are implemented and unit-checked. Default field selections follow the Jobber schema as published; if a field in a default selection is rejected by your API version, use the **Fields** option and please open an issue.

## Resources

- [Jobber developer docs](https://developer.getjobber.com/docs/)
- [Jobber API changelog and active versions](https://developer.getjobber.com/docs/changelog)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE)
