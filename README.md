# Mankaleshwar Mahadev Backend

TypeScript API service for the Mankaleshwar Mahadev Temple website.

## Stack
- Node.js 22+
- Fastify 5 and TypeScript
- PostgreSQL 17 hosted on Neon
- Zod request and environment validation

## Run locally
1. Copy .env.example to .env.
2. Set DATABASE_URL to a PostgreSQL connection string (use a pooled Neon URL for API traffic).
3. Install dependencies with npm install.
4. Run npm run db:migrate to apply pending migrations.
5. Run npm run dev.

## Commands
- npm run dev — development server with reload
- npm run typecheck — TypeScript type checking
- npm run build — compile to dist/
- npm start — run compiled server
- npm run db:migrate — apply pending SQL migrations and record checksums
- npm run test:integration — run PostgreSQL-backed API integration tests (requires DATABASE_URL)
- npm run admin:create — one-time creation of the single admin account; requires DATABASE_URL, ADMIN_EMAIL, and ADMIN_PASSWORD (12+ characters)

## API v1
All endpoints are under /api/v1.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /health | Process health check |
| GET | /photos | List published photos; from/to filter by upload date; supports limit, offset |
| POST | /photos/:photoId/likes | Add an idempotent guest like using a client-generated visitorId UUID |
| DELETE | /photos/:photoId/likes | Remove the guest's like using the same visitorId UUID |
| GET | /comments/predefined | List active predefined guest comment options |
| GET | /photos/:photoId/comments | List comments for a published photo; supports limit, offset |
| POST | /photos/:photoId/comments | Publish a predefined or custom guest comment immediately |
| GET | /announcements | List published announcements; supports limit, offset |
| PUT | /push-subscriptions | Register/update a browser push subscription for one or both notification channels |
| POST | /admin/auth/login | Authenticate the single admin and issue an HttpOnly session cookie |
| POST | /admin/auth/logout | Revoke the current admin session |
| GET | /admin/auth/me | Check the current admin session |

## Single-admin security
Apply database migration 002 before enabling admin authentication. It creates server-side sessions and a database constraint that permits only one admin row. Admin passwords are hashed with Node.js scrypt and a random salt; raw passwords are never stored. Session tokens are random, stored only as SHA-256 hashes, and delivered in HttpOnly, SameSite=Strict cookies (Secure in production). Login is rate-limited.

Provision the account once using the deployment environment's secret variables: DATABASE_URL, ADMIN_EMAIL, and ADMIN_PASSWORD (minimum 12 characters), then run npm run admin:create. Do not leave ADMIN_PASSWORD configured after provisioning. Do not expose the provisioning command as a public HTTP endpoint.

The content endpoints require DATABASE_URL. If it is not configured, they return HTTP 503 rather than pretending the database is available.

## Guest comments
Guests do not need accounts. The predefined comments endpoint returns active options; the POST endpoint accepts exactly one of predefinedCommentId or custom body, snapshots the selected text into the comment row, and returns the newly published comment immediately. The comments list is restricted to published photos. The confirmed predefined option "Har Har Mahadev" is seeded by migration 003.

The visitorId is an opaque client-generated UUID, not authenticated identity. It can be spoofed, so it must not be treated as proof of a unique person. Stronger abuse prevention depends on a product policy decision and is not claimed by this API.

## Browser notification subscriptions
PUT /push-subscriptions stores browser subscriptions and channel choices only. Push delivery, VAPID key management, retries, and automatic publish triggers remain separate implementation work.

## Database and migrations
SQL migrations are stored in database/migrations and must be append-only after they have been applied. Run npm run db:migrate before starting a deployment.

The migration runner records filenames and SHA-256 checksums in schema_migrations, applies each pending migration transactionally, and rejects edited applied migrations. On an already-initialized database, it recognizes the existing 001/002 schema and baselines those migrations before applying new ones. If it detects a partial schema, it stops rather than guessing.

The initial schema has been applied to Neon project mankaleshwar-mahadev (PostgreSQL 17, AWS Singapore). Photo upload time is stored separately in uploaded_at and is the date used by the public photo filters. Never commit database credentials or admin secrets.

CI uses an ephemeral PostgreSQL 17 service, applies migrations to an empty database, runs the migration command a second time to verify idempotency, and runs the API integration tests. This does not replace testing against the production Neon database.

## Storage
The selected media storage is a private Backblaze B2 bucket. Storage keys are the durable database references. Media URL columns are optional for compatibility and must not contain long-lived assumptions about private objects; the backend will generate short-lived download/view URLs when the B2 integration is implemented. The storage integration is not implemented yet.

## Remaining implementation
- Admin photo and announcement management APIs
- Backblaze B2 private media integration and secure URL delivery
- Browser push delivery and automatic publish triggers
- Broader automated API/database integration tests for photos, likes, admin sessions, announcements, and push subscriptions
- Production hosting configuration and live deployment
- Pujari/admin contact workflow (not decided)
