# Publishing n8n-nodes-jobber

Two separate things: putting the package on npm (which makes it installable in any self-hosted n8n through Settings > Community Nodes), and getting it **verified** by n8n (which lists it in the in-app node panel, makes it installable on n8n Cloud, and puts it on n8n's integrations pages). Verification needs the npm publish first.

## 1. GitHub repository

1. The code lives in the public repository `https://github.com/Fahad-23/Custom-Nodes-n8n`, which package.json and the codex files point at. The npm package name stays `n8n-nodes-jobber`; the repo name does not have to match, but the npm author and the repo owner must be the same person.
2. From this folder:

```bash
git add -A
```

```bash
git commit -m "Jobber node, trigger and OAuth2 credential"
```

```bash
git branch -M main
```

```bash
git remote add origin git@github.com:Fahad-23/Custom-Nodes-n8n.git
```

```bash
git push -u origin main
```

The scaffolded `.github/workflows/ci.yml` will lint and build on every push.

## 2. npm account and trusted publishing

Since 1 May 2026 n8n only verifies packages published from GitHub Actions with a provenance statement, never from a laptop. The scaffold's `publish.yml` does that on every version tag.

1. Create an npm account at npmjs.com if you do not have one, and enable two-factor auth.
2. The first publish cannot use trusted publishing because the package does not exist on npm yet. Two options:
   - Publish version 0.1.0 once from your machine with `npm login` then `npm publish --access public`, then switch to trusted publishing for every later release. (Verification reviewers look at the latest version, which will have provenance.)
   - Or create a granular access token on npmjs.com scoped to this package, store it as the `NPM_TOKEN` secret in the GitHub repository, and let `publish.yml` do the first release. This path has provenance from day one.
3. After the package exists on npm: npmjs.com > package > Settings > Publish access > Trusted Publishers > Add GitHub Actions with owner `Fahad-23`, repository `n8n-nodes-jobber`, workflow `publish.yml`. Then delete the `NPM_TOKEN` secret if you created one.

## 3. Releasing a version

```bash
npm run release
```

This runs lint and build, asks for the version bump, updates CHANGELOG.md, commits, tags and pushes. The tag push triggers `publish.yml`, which publishes to npm with provenance. Check the Actions tab for the result and npmjs.com for the new version.

Before the first release, do a live test against a real Jobber developer account (see section 5). Lint and the webhook test pass, but no query in this package has yet been run against Jobber's API.

## 4. Submitting for verification

1. Run the same scanner n8n uses:

```bash
npx @n8n/scan-community-package n8n-nodes-jobber
```

2. Submit at https://creators.n8n.io/nodes with the npm package name. Reviews take up to four weeks.

What the reviewers check, and where this package stands:

| Requirement | Status |
|---|---|
| Name starts with `n8n-nodes-` | Yes |
| MIT license | Yes (LICENSE file, package.json) |
| No runtime dependencies | Yes, only devDependencies and the `n8n-workflow` peer |
| No environment variables or file system access | Yes |
| One third-party service per package | Yes, Jobber only |
| Not a duplicate of an existing built-in node | Yes, n8n has no Jobber node |
| English README and docs | Yes |
| Published through GitHub Actions with provenance | After step 2 |
| npm author matches repository owner | Make sure the npm account's name or email matches the package.json author |
| Passes `n8n-node lint` in strict (cloud) mode | Yes, zero findings |

Unverified community packages exist for Jobber already (five on npm, all tiny and unmaintained, one with LangChain as a runtime dependency, which disqualifies it). None is verified. Being the verified one is the whole point.

## 5. Live test before publishing

You need a Jobber developer account (free, 90-day test account, extendable by emailing api-support@getjobber.com).

1. In the Developer Center create an app, set the OAuth callback URL to the one shown by the n8n credential, pick scopes (at least `read_clients`, `write_clients`, `read_jobs`, `read_quotes`, `read_invoices`, `read_requests`), and copy the client ID and secret.
2. In n8n create the Jobber OAuth2 credential, connect, and confirm the credential test passes (it runs `account { id name }`).
3. Run each resource's Get Many with a small limit, then Get with one of the returned IDs. If any default field is rejected by the schema, trim it in `nodes/Jobber/queries.ts` and note it in the changelog.
4. Create, update and archive a test client.
5. Register the trigger URL for `CLIENT_CREATE` in the Developer Center, create a client in Jobber, and confirm the workflow runs.

## 6. Local test environment

A throwaway n8n with the package mounted, on a port that does not clash with your own instance:

```bash
docker run -d --name n8n-jobber-test -p 5679:5678 -e N8N_CUSTOM_EXTENSIONS=/custom -e N8N_SECURE_COOKIE=false -v "$PWD:/custom/n8n-nodes-jobber:ro" n8nio/n8n:latest
```

Rebuild with `npm run build` and `docker restart n8n-jobber-test` to pick up changes. Remove it with `docker rm -f n8n-jobber-test`.
