# How this node works, and how n8n nodes work in general

How this package is put together. Part 1 is background on n8n's node model. Part 2 covers why it was built and the decisions made along the way. Part 3 follows a request through the code, file by file.

---

## Part 1. How n8n nodes work

### What a node is

An n8n workflow is a graph of nodes. Each node receives a list of items (JSON objects, sometimes with binary data), does something, and passes a list of items on. A trigger node has no input and starts the workflow when something happens: a webhook arrives, a schedule fires, a poll finds new data.

Under the hood a node is a TypeScript class with two parts:

1. **`description`**: static metadata that the editor uses to draw the node. Display name, icon, which credentials it needs, and a `properties` array that defines every field the user can fill in. n8n renders the form from this array; the node author never writes UI code.
2. **Behaviour**: either an `execute()` method (programmatic style) that runs when the node is reached, or, for triggers, a `webhook()` or `poll()` method.

n8n ships about 450 nodes in its own `nodes-base` package. Anything else is a **community node**: an npm package whose `package.json` carries an `n8n` block pointing at the compiled node and credential files, and the keyword `n8n-community-node-package` so the registry can find it.

```json
"n8n": {
  "n8nNodesApiVersion": 1,
  "strict": true,
  "credentials": ["dist/credentials/JobberOAuth2Api.credentials.js"],
  "nodes": ["dist/nodes/Jobber/Jobber.node.js", "dist/nodes/JobberTrigger/JobberTrigger.node.js"]
}
```

When n8n starts it reads that block, requires each file, instantiates the class, and registers it under the package name. Users install community packages from Settings > Community Nodes, which runs `npm install` in n8n's own nodes directory.

### Declarative vs programmatic

n8n has two authoring styles.

- **Declarative**: no `execute()` at all. Each property carries a `routing` block that tells n8n how to turn the value into part of an HTTP request (`routing.request.url`, `routing.send.property` and so on). Good for plain REST APIs where one operation equals one request.
- **Programmatic**: the class implements `execute()` and does the work itself with `this.helpers.httpRequest` and friends. Needed whenever an operation makes several calls, loops over pages, or has to inspect the response before deciding what to return. Triggers must be programmatic.

This package is programmatic because Jobber is GraphQL. Every call is a POST to one URL with a query string in the body, errors arrive inside a 200 response, collections are paged by cursor, and mutations carry validation failures in a `userErrors` array. None of that fits declarative routing.

### The pieces of a programmatic node

**Properties.** The convention is a `Resource` dropdown (Client, Job, Quote...), then an `Operation` dropdown per resource (Get, Get Many, Create...), then the fields each operation needs. `displayOptions.show` hides a field unless the chosen resource and operation match. Field types include `string`, `number`, `boolean`, `options`, `collection` (an "Add field" group of optional inputs), `fixedCollection`, `json` and `notice` (a static hint box).

**Credentials.** A separate class implementing `ICredentialType`. Its `properties` define what the user types (API key, client ID, secret). For OAuth2 the class sets `extends = ['oAuth2Api']` and inherits n8n's whole OAuth2 machinery: the connect button, the redirect URL, token exchange, storage of the token, and refresh when a request returns 401. The node declares `credentials: [{ name: 'jobberOAuth2Api', required: true }]` and calls `this.helpers.httpRequestWithAuthentication.call(this, 'jobberOAuth2Api', options)`; n8n injects the bearer token and handles refresh transparently.

**execute().** Receives all input items via `this.getInputData()`, loops over them, reads parameters per item with `this.getNodeParameter(name, i)`, calls the API, and returns `[returnData]`: an array of output branches, each an array of items. Every output item carries `pairedItem: { item: i }` so n8n can trace which input produced which output. Errors are thrown as `NodeApiError` (the API said no) or `NodeOperationError` (bad configuration or input). If the user ticked "Continue on fail", the loop catches the error and emits `{ error: message }` instead.

**Triggers.** A webhook trigger declares a `webhooks` array in its description (`httpMethod`, `path`, `responseMode`). n8n registers a URL per workflow per node, and calls the class's `webhook()` method on each request. The method reads headers and body, decides whether to start the workflow, and returns `{ workflowData: [[items]] }` to start it or `{ webhookResponse: ... }` to just answer. Three lifecycle methods, `checkExists`, `create` and `delete`, let n8n register the webhook URL with the external service on activation and remove it on deactivation.

**Tooling.** `@n8n/node-cli` (`npm create @n8n/node`) scaffolds a package with TypeScript config, an ESLint config that enforces n8n's conventions (sentence-case labels, "ID" capitalisation, every trigger must implement all three lifecycle methods, no raw `throw error`, and so on), a `build` command that compiles to `dist/` and copies icons, and a `release` command that tags and publishes through GitHub Actions with npm provenance. Verification by n8n (which lists the node in-app and allows it on n8n Cloud) requires MIT licence, no runtime dependencies, no file system or environment access, and a passing lint in strict mode.

---

## Part 2. How this package was built

### Why Jobber

Jobber is the field-service platform used by HVAC, plumbing, landscaping and cleaning businesses. I had already integrated it for an Upwork client (a US HVAC company with an after-hours voice agent that logged calls into GoHighLevel and Jobber), so I knew the shape of the API and the kind of automations people want.

Before writing anything I checked what existed:

- n8n has no native Jobber node. The integration catalogue has no page for it.
- Five community packages exist on npm. All tiny (8 to 19 downloads a week), none verified, one whose repository has been deleted, one that pulls LangChain and zod in as runtime dependencies, which by itself fails verification.
- Forum threads from 2022 and 2025 ask for a Jobber node and get told to use the generic GraphQL node, with a follow-up complaint that OAuth2 token refresh breaks because Jobber answers errors with HTTP 200.

So the opening was not "nobody has tried" but "nobody has done it properly". That shaped the goals: no runtime dependencies, strict lint from day one, and the three things the generic node gets wrong handled in the transport layer.

### Research

Jobber's developer site refuses automated fetches, so the docs were read page by page in a browser. The facts the code depends on:

| Fact | Value | Where it is used |
|---|---|---|
| Endpoint | `POST https://api.getjobber.com/api/graphql` | `transport.ts` |
| Required header | `X-JOBBER-GRAPHQL-VERSION`, a date like `2026-09-25`, supported 12 months | credential property, sent on every call |
| Auth | OAuth 2.0 authorization code; `client_id` and `client_secret` in the token request body; no `scope` parameter (scopes live on the app) | credential class |
| Token lifetime | 60 minutes; refresh tokens rotate and the old one is invalidated immediately for apps created after January 2024 | relies on n8n persisting the new refresh token, which it does (`{ ...token.data, ...newToken.data }` in n8n core) |
| Rate limit | cost based: 10,000 points per app and account, restored at 500 per second; a throttled query returns `errors[0].extensions.code = "THROTTLED"` and `extensions.cost.throttleStatus` | retry logic in `transport.ts` |
| Pagination | Relay cursors: `first`, `after`, `pageInfo { hasNextPage endCursor }`, max 100 per page | `jobberGetMany` |
| Webhooks | registered per app in the Developer Center, not via API; payload is `data.webHookEvent { topic appId accountId itemId occurredAt }` with IDs only; at-least-once delivery; must answer within 1 second | trigger design |
| Signature | header `X-Jobber-Hmac-SHA256`, base64 of HMAC-SHA256 over the raw body, keyed with the app's OAuth client secret | `signature.ts` |

The two facts most likely to be wrong from memory, the newest active API version and the signature scheme, were checked a second time directly against the changelog and webhook pages.

The GraphQL schema itself is only browsable behind a login (GraphiQL), so the field selections in `queries.ts` were cross-checked against two sources: the example queries in the docs and the selection sets used by the two most recent existing packages. They are still marked as unverified until a run against a live developer account.

### Scaffold and design decisions

`npm create @n8n/node@latest n8n-nodes-jobber -- --template programmatic/example` produced the skeleton. From there:

- **One credential, two nodes.** A regular `Jobber` node and a `Jobber Trigger`. n8n also auto-generates a `Jobber Tool` variant because the node sets `usableAsTool: true`, which lets an AI Agent node call it.
- **API version on the credential, not the node.** Jobber retires versions; putting the date on the credential means one change updates every workflow. Default is the newest active version.
- **Lean default field selections plus a Fields override.** Jobber charges query cost per field, and nobody can predict which custom field a user needs. Every Get and Get Many has a `Fields` option that replaces the selection set with whatever the user pastes.
- **A raw GraphQL operation** through the same transport, so anything the resource operations do not cover still gets throttle handling and error mapping.
- **Mutations only where the input shape is small.** Client create, update and archive. Jobs, quotes and invoices have deep input types that would need a live schema to get right, so they are read-only for now and reachable through raw GraphQL.
- **Trigger with manual registration.** Jobber webhooks cannot be created through the API, so the lifecycle methods are no-ops and the node shows a notice telling the user to paste the URL into the Developer Center. The lint rule requiring all three methods is satisfied; the honesty is in the notice.
- **Trigger emits IDs plus context, not the full record.** Jobber only sends IDs. Fetching the object inside the webhook would risk the 1-second response limit, so the README shows the trigger followed by a Jobber Get node instead.

### Testing

Lint runs in strict (cloud) mode and passes with zero findings. The build produces `dist/`.

For a live load test, a throwaway n8n container was started on a spare port with the package directory mounted as a custom extension:

```bash
docker run -d --name n8n-jobber-test -p 5679:5678 \
  -e N8N_CUSTOM_EXTENSIONS=/custom -e N8N_SECURE_COOKIE=false \
  -v "$PWD:/custom/n8n-nodes-jobber:ro" n8nio/n8n:latest
```

In that instance both nodes and the credential appeared with their icons, the credential test was present, and a workflow with the trigger was published. Then six requests were fired at the production webhook URL with `curl`, signing the body with `openssl dgst -sha256 -hmac`:

| Case | Expected | Got |
|---|---|---|
| Valid signature, selected topic | 200, workflow runs | 200, execution recorded |
| Same event again | 200, ignored | "Ignored: duplicate delivery" |
| Body tampered after signing | 401 | "Invalid Jobber signature" |
| No signature header | 401 | "Invalid Jobber signature" |
| Valid signature, topic not selected | 200, ignored | "Ignored: topic not selected" |
| Second valid event, other topic | 200, workflow runs | 200, execution recorded |

Response time was about 55 ms.

### The bug the test found

The first version stored seen events in n8n's workflow static data (`this.getWorkflowStaticData('node')`). It passed the first test run. After restarting the container, duplicates started getting through. The cause: in n8n 2.x's production webhook path, static data written inside `webhook()` is not persisted; the execution that follows is built from the stored workflow, and only changes made during the execution are saved. The in-process cache had masked it the first time.

The fix was a module-level `Map` of event keys with timestamps, pruned on every call and capped at 5,000 entries. It covers the real case (Jobber firing the same topic twice a second apart, and retries after a timeout) and the README states the limitation: in queue mode with several webhook processors, a retry that lands on a different processor is not caught.

A second, smaller finding: in `onReceived` mode n8n ignores the `webhookResponse` a trigger returns alongside `workflowData` and instead sends the body chosen by the `responseData` field of the webhook description. The default made it reply with the literal string `firstEntryJson`. Setting `responseData: 'noData'` gives an empty 200, which is what Jobber wants.

---

## Part 3. How it works, file by file

```
credentials/JobberOAuth2Api.credentials.ts   OAuth2 credential + API version + credential test
nodes/Jobber/transport.ts                    one GraphQL call, throttle retry, pagination, mutation payload parsing
nodes/Jobber/queries.ts                      selection sets per resource, query and mutation builders
nodes/Jobber/descriptions.ts                 the properties array (resources, operations, fields)
nodes/Jobber/Jobber.node.ts                  the node class and execute()
nodes/JobberTrigger/signature.ts             HMAC verification
nodes/JobberTrigger/JobberTrigger.node.ts    the trigger class and webhook()
```

### The credential

`JobberOAuth2Api` extends `oAuth2Api`. Its properties are mostly hidden constants: grant type `authorizationCode`, the authorize and token URLs, `authentication: 'body'` (client ID and secret go in the form body, as Jobber requires), an empty `scope` (Jobber ignores it; scopes are configured on the app). The one visible extra field is `apiVersion`.

It also has a `test` block: a POST to the GraphQL endpoint with `query CredentialTest { account { id name } }` and the version header. For OAuth2 credentials n8n runs this after the user connects; without it, n8n only checks that a token exists.

### A read request, end to end

Take "Client > Get Many, search term `Smith`, limit 50".

1. `execute()` reads `resource`, `operation`, `returnAll`, `limit`, `searchTerm` and `options` for the current item.
2. `getMany()` calls `buildGetManyQuery('client', { withSearch: true, withFilter: false })`, which produces:
   ```graphql
   query GetManyClient($first: Int!, $after: String, $searchTerm: String) {
     clients(first: $first, after: $after, searchTerm: $searchTerm) {
       nodes { id name firstName lastName companyName isCompany isLead isArchived jobberWebUri createdAt updatedAt }
       pageInfo { hasNextPage endCursor }
     }
   }
   ```
   The variable list and argument list are only extended when a search term or filter is actually set, so the query stays valid for resources that do not support search.
3. `jobberGetMany()` loops: page size is `min(100, remaining)`, it calls `jobberGraphql()` with `{ searchTerm, first, after }`, reads the `clients` connection with `readConnection()`, appends the nodes, and continues while `hasNextPage` and the limit is not reached.
4. `jobberGraphql()` reads the credential to get the API version, POSTs `{ query, variables }` through `httpRequestWithAuthentication`, and inspects the response:
   - not an object: `NodeOperationError`
   - `errors` present and one has `extensions.code === 'THROTTLED'` and retries remain: compute the wait from `throttleStatus` (shortfall divided by restore rate, plus a small margin, capped at 15 s), sleep, try again
   - `errors` present otherwise: `NodeApiError` with every message and its path joined
   - no `data`: `NodeOperationError`
   - else return `data`
5. Back in `execute()`, the array of clients goes through `returnJsonArray` and `constructExecutionMetaData` so each becomes an output item paired with input item `i`.

### A mutation

"Client > Create" builds a `ClientCreateInput` from the typed fields (first name, last name, company name; an email becomes `emails: [{ address, primary: true }]`, a phone becomes `phones: [{ number, primary: true }]`) and merges in the optional "Extra Input (JSON)" object for anything else. The query is:

```graphql
mutation ClientCreate($input: ClientCreateInput!) {
  clientCreate(input: $input) { client { ...fields } userErrors { message path } }
}
```

`readMutation()` looks at `data.clientCreate`. If `userErrors` is non-empty it throws a `NodeApiError` listing each message with its path (for example `Email address is invalid (emails.0.address)`), because Jobber returns those with HTTP 200 and the user would otherwise see a silent success. Otherwise it returns the `client` object.

### The trigger

`webhook()` runs for every POST to the node's URL:

1. **Verify.** Unless the user turned it off, read the credential's `clientSecret`, the `x-jobber-hmac-sha256` header, and `req.rawBody` (n8n keeps the raw bytes for JSON requests). `verifyJobberSignature()` computes base64 HMAC-SHA256 over the raw body and compares with `crypto.timingSafeEqual` after a length check (that function throws on unequal lengths). A mismatch answers 401 and returns `{ noWebhookResponse: true }` so n8n does not reply a second time.
2. **Parse.** Pull `data.webHookEvent` from the body. Missing or malformed: 400.
3. **Filter.** If the `Topics` field is non-empty and the event's topic is not in it, answer 200 with a short "ignored" text and do not start the workflow. Jobber registers one URL per topic, so this matters when one n8n URL is reused for several topics.
4. **Deduplicate.** Key is `nodeId|topic|itemId|occurredAt`. If seen inside the window (120 s default), ignore. Otherwise record it.
5. **Emit.** One item: `topic`, `objectType` (first segment of the topic, lower-cased, so `CLIENT_CREATE` gives `client`), `itemId`, `accountId`, `appId`, `occurredAt`, `receivedAt`, and the raw `payload`. The workflow starts; n8n sends the empty 200 because of `responseData: 'noData'`.

The output is deliberately shaped so the next node can be a Jobber node with resource `{{ $json.objectType }}` and ID `{{ $json.itemId }}`.

### What the lint enforces that shaped the code

- Every catch in `execute()` must rethrow as `NodeApiError` or `NodeOperationError`, never the raw error.
- Operation labels are sentence case ("Get many clients", not "Get Many Clients") and `ID` is always upper case in labels and placeholders. A GraphQL placeholder that started with `id` had to be reworded for that rule.
- A trigger with a `webhooks` array must implement `checkExists`, `create` and `delete`.
- Trigger classes end in `Trigger`, with `inputs: []`.
