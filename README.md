# Stackroom

> Your builds, kept close.

Stackroom is a private developer workspace for keeping projects and their technical infrastructure organized in one place.

Track the details that are usually scattered across domain registrars, hosting platforms, repositories, databases, design tools, and personal notes.

## Features

- Secure authentication with Neon Auth
- Google OAuth sign-in
- Per-user project management with server-side ownership checks
- Project metadata including status, priority, category, description, and notes
- Domain management with registrar, DNS provider, expiration, and auto-renew details
- Deployment tracking with provider, environment, URL, branch, and status
- Database tracking with provider, type, environment, and console URL
- Technology tags and project links
- Project health and completeness indicators
- Activity timeline
- Global domain registry
- Attention queue for domains, inactive projects, and incomplete records
- Global project search
- Command palette with `Ctrl/Cmd + K`
- Grid and list views
- Responsive interface
- GitHub integration
- Repository linking and metadata

## Tech Stack

- **Backend:** Go
- **Database:** PostgreSQL
- **Database Platform:** Neon
- **Authentication:** Neon Auth
- **GitHub Integration:** GitHub App + GitHub API
- **Frontend:** HTML, CSS, JavaScript

## Architecture

```text
User
 │
 ├── Neon Auth
 │
 └── Projects
      ├── Domains
      ├── Deployments
      ├── Databases
      ├── Technologies
      ├── Links
      ├── Activity
      └── GitHub Repository
