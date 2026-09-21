# Stackroom v3

Stackroom is a private project workspace built with Go + PostgreSQL/Neon. It keeps the technical details that tend to get scattered across registrar dashboards, hosting providers, repositories, databases, design tools and notes in one place.

## What is in v3

- Neon Auth-backed sign in/sign up and Google OAuth proxy
- Per-user project CRUD with server-side ownership checks
- Rich project records: status, priority, category, description and notes
- Domains: hostname, registrar, DNS provider, expiry and auto-renew metadata
- Deployments: provider, environment, URL, repository, branch and status
- Databases: provider, type, environment and console URL
- Typed technology tags and project links
- Project completeness / health indicator
- Activity timeline for project creation and updates
- Global domain registry
- Attention queue for expired / soon-to-expire domains, quiet projects and incomplete records
- Global project search across metadata
- Command palette with Ctrl/Cmd + K
- Grid / list views and responsive UI
- Safe PostgreSQL migration from the earlier Stackroom schema

## Run locally

1. Copy `.env.example` to `.env` and set your Neon values.
2. Run `schema.sql` against the Neon branch used by Stackroom. The migration uses `create ... if not exists`, additive columns and backfills, so it is designed to upgrade the previous schema in place.
3. Enable Managed Better Auth for the same Neon branch and set `NEON_AUTH_BASE_URL`.
4. Enable Google sign-in if you want the Google button to work.
5. Start the Go server:

```powershell
go mod tidy
go run .
```

Open `http://localhost:8080`.

### Environment

```text
DATABASE_URL=...
NEON_AUTH_BASE_URL=...
PORT=8080
```

Never commit `.env`.

## Architecture

```text
projects
  ├── project_domains
  ├── project_deployments
  ├── project_databases
  ├── project_technologies
  ├── project_links
  └── project_activity
```

Every project read, update and delete is scoped by the authenticated Neon Auth user ID. Child rows are replaced transactionally when a project is updated.

## Security note

Do not store database passwords, API secrets, private keys or full `DATABASE_URL` values as ordinary project metadata. A future secrets integration should use a dedicated secret manager and display masked references in Stackroom.

## Verification

`app.js` passes the Node.js syntax check. Final Go compilation could not be completed in the offline build environment because the container could not download the existing Go dependencies from `proxy.golang.org`.