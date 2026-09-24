# Stackroom

**Current release: v4.1.0 — Privacy Core**

Stackroom is a private project workspace built with Go + PostgreSQL/Neon.

It keeps the technical details that tend to get scattered across registrar dashboards, hosting providers, repositories, databases, design tools, and notes in one place.

**Your builds, kept close.**

## What is in v4.1.0

### Privacy Core

- Browser-side encrypted Private Vault
- Client-side encrypted project storage
- Encrypted project CRUD
- Vault create, unlock, lock, and reload flows
- Safe migration of legacy plaintext projects
- Migration integrity and rollback protections
- AES-256-GCM encryption with Web Crypto
- PBKDF2-SHA256 passphrase-based key derivation
- Vault passphrase is never sent to the server
- Private project content is encrypted before reaching Stackroom servers

### Project workspace

- Neon Auth-backed sign in/sign up
- Google OAuth support
- Per-user project ownership checks
- Rich project records
- Domains, deployments, databases, technologies, links, and notes
- Project health / completeness indicator
- Global domain registry
- Attention queue
- Global search
- Command palette with Ctrl/Cmd + K
- Grid / list views
- Responsive UI

### GitHub integration

- GitHub App connection
- Repository import
- Repository search
- Project repository linking
- Encrypted GitHub access and refresh tokens
- Refresh token support

### Security hardening

- Restrictive Content Security Policy
- Security headers
- Cross-origin write protection
- Request body limits
- Encrypted payload validation
- Restricted public asset serving
- XSS protections
- Unsafe URL protections
- Security regression tests

## Privacy architecture

Vault passphrase
    ↓
PBKDF2-SHA256
    ↓
AES-256-GCM wrapping key
    ↓
Wrapped master key

Project content
    ↓
Web Crypto API
    ↓
AES-256-GCM encryption
    ↓
ciphertext + IV
    ↓
Go API
    ↓
Neon PostgreSQL


Private project content is encrypted in the browser before it reaches Stackroom's servers.

Stackroom stores encrypted project payloads rather than plaintext private project content.

The frontend application is still delivered by Stackroom itself, so Stackroom does not currently make the stronger claim that the service operator could never technically access plaintext under every possible threat model.

Architecture


user_vaults
    └── encrypted master-key metadata

projects
    ├── encrypted_payload
    ├── encryption_version
    ├── project_domains
    ├── project_deployments
    ├── project_databases
    ├── project_technologies
    ├── project_links
    └── project_activity

github_connections
    └── encrypted access / refresh tokens


    Authenticated project operations are scoped to the current Neon Auth user.

Legacy plaintext projects can be migrated into encrypted storage after the user unlocks their vault.

Run locally
Copy .env.example to .env.
Configure Neon PostgreSQL and Neon Auth.
Run schema.sql and the required migrations.
Configure GitHub App environment variables if needed.
Start Stackroom:
go mod tidy
go run .

Open:

http://localhost:8080
GitHub App

Production callback:

https://stackroom.site/api/integrations/github/callback

Local callback:

http://localhost:8080/api/integrations/github/callback

Repository permission required for v4.1.0:

Metadata: Read-only
Security

Stackroom is a project workspace, not a dedicated secrets manager.

Do not store raw database passwords, private keys, seed phrases, API secrets, or other high-value credentials as ordinary project content.




Verification

Stackroom v4.1.0 was validated with:

go test ./...                         PASS
go vet ./...                          PASS
go build ./...                        PASS
vault_browser_test.py                 PASS
legacy_migration_browser_test.py      PASS
production smoke test                 7/7 PASS
Production



https://stackroom.site



Releases
v4.1.0 — Privacy Core

Introduced browser-side encrypted private project storage, Private Vault, safe legacy migration, security hardening, and regression coverage.

v4.0.0 — GitHub Integration

Introduced GitHub App connectivity, repository import, project linking, encrypted token storage, and refresh-token support.

v3.0.2

Fixed Neon Auth OAuth callback handling and session verifier forwarding.
