# Changelog

## 0.1.0

- Jobber OAuth2 credential with configurable API version.
- Jobber node: Client (create, get, get many, update, archive); Request, Quote, Job, Invoice and Visit (get, get many); raw GraphQL execute.
- Cursor pagination with Return All / Limit, search term, JSON filter, and a Fields option to override the selection set.
- Cost-based throttle handling: waits for points to restore and retries, surfaces GraphQL `errors` and mutation `userErrors` as node errors.
- Jobber Trigger: webhook receiver with HMAC-SHA256 signature verification, topic filter, and duplicate-delivery suppression.
