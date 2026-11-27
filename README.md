# Mankaleshwar Mahadev Backend

TypeScript API service for the Mankaleshwar Mahadev Temple website.

## Stack
- Node.js 22+, Fastify 5 and TypeScript
- PostgreSQL 17 hosted on Neon
- Backblaze B2 private bucket through its S3-compatible API
- Zod request and environment validation
- Browser Web Push using VAPID with separate Photos and Announcements channels

## Run locally
1. Copy .env.example to .env.
2. Set DATABASE_URL to a PostgreSQL connection string (use a pooled Neon URL for API traffic).
3. Configure the five Backblaze variables below.
4. Install dependencies with npm install.
5. Run npm run db:migrate, then npm run dev.

## Commands
- npm run dev — development server with reload
- npm run typecheck — TypeScript type checking
- npm run build — compile to dist/
- npm start — run compiled server
- npm run db:migrate — apply pending SQL migrations and record checksums
- npm run test:unit — run isolated unit tests
- npm run test:integration — run PostgreSQL-backed API integration tests (requires DATABASE_URL)
- npm run admin:create — one-time single-admin provisioning; requires DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD (12+ characters)

## API v1
All endpoints are under /api/v1.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /health | Process liveness check |
| GET | /ready | Database readiness check (503 when unavailable) |
| GET | /photos | Published photos; upload-date filters; returns temporary B2 URLs |
| POST | /photos/:photoId/likes | Add an idempotent guest like |
| DELETE | /photos/:photoId/likes | Remove the guest like |
| GET | /comments/predefined | Active predefined guest comments |
| GET | /photos/:photoId/comments | List comments for a published photo |
| POST | /photos/:photoId/comments | Publish a guest comment immediately |
| GET | /announcements | Published announcements with temporary B2 poster URLs |
| PUT | /push-subscriptions | Register/update browser push channel subscriptions |
| POST | /admin/auth/login | Admin login |
| POST | /admin/auth/logout | Revoke admin session |
| GET | /admin/auth/me | Check admin session |
| POST | /admin/photos | Admin-only photo upload and immediate publication |
| POST | /admin/announcements | Admin-only announcement text/poster creation and immediate publication |

## Admin authentication
Passwords are hashed with Node.js scrypt and random salt. Session tokens are random, stored only as SHA-256 hashes, and delivered in HttpOnly, SameSite=Strict cookies (Secure in production). Login is rate-limited. Provision the single account once using DATABASE_URL, ADMIN_EMAIL, and ADMIN_PASSWORD through the one-time admin:create command. Do not commit or expose these secrets.

## Private Backblaze B2 storage
The backend uses Backblaze's S3-compatible API. Keep the bucket private; this integration does not set public ACLs. Object keys are generated server-side under photos/ and announcements/. PostgreSQL stores those permanent keys, never expiring URLs. Public list endpoints generate presigned GET URLs when content is requested. Existing legacy rows with a media_url and no storage_key continue to return their original URL.

Configure all five values together in the backend hosting provider's encrypted environment settings:
- B2_ENDPOINT — HTTPS S3 endpoint for the bucket's region, exactly as shown by Backblaze
- B2_REGION — matching S3 region identifier
- B2_BUCKET — exact private bucket name
- B2_KEY_ID — Backblaze application key ID
- B2_APPLICATION_KEY — corresponding secret

Create an application key scoped to this bucket, with only the required object read/write/delete capabilities. Never put the key ID or secret in GitHub source files or chat. Endpoint and region must match the bucket. Partial configuration fails startup validation.

B2_SIGNED_URL_TTL_SECONDS defaults to 900 seconds (15 minutes; allowed range 60–3600). MAX_MEDIA_UPLOAD_BYTES defaults to 25,000,000 bytes. Accepted uploads are JPEG, PNG, WebP, and AVIF; SVG is not accepted.

Photo upload uses multipart/form-data with one file field:
POST /api/v1/admin/photos?caption=...&takenAt=...
The authenticated admin uploads and immediately publishes the image. The database stores the object key and the API returns a signed URL. If database insertion fails after upload, the backend attempts to delete the orphaned object.

Announcement publication uses multipart/form-data with optional title, message, and one poster image:
POST /api/v1/admin/announcements
At least message text or a poster image is required. Text-only announcements do not require B2. Scheduling, editing, and deletion policies are not assumed or implemented.

## Browser push notifications

The backend uses the standard Web Push protocol. Publishing a photo queues a notification for subscribers of the `photos` channel; publishing an announcement queues one for subscribers of the `announcements` channel. A PostgreSQL outbox stores pending notifications and a background worker retries delivery with exponential backoff (up to 10 attempts), so queued notifications survive API process restarts. Expired endpoints returning 404 or 410 are removed. Delivery remains queued until all three VAPID settings are configured. Content publication and outbox insertion use the same PostgreSQL transaction, so they either both commit or both roll back. Push subscription endpoints are restricted to known browser push providers (Google FCM, Mozilla, Apple, and Microsoft) to reduce server-side request forgery risk.

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` — a `mailto:` contact or HTTPS URL

Generate VAPID keys with a trusted Web Push key-generation tool and configure these values as encrypted hosting secrets. Never commit private keys. Browser clients must use the matching public key when subscribing.

## Production CORS
Set `CORS_ORIGINS` to a comma-separated list of exact frontend origins (scheme + hostname + optional port; no paths or trailing slashes). Production requires HTTPS origins and rejects localhost and wildcard origins.

## Database
Migrations are append-only under database/migrations. The migration runner records SHA-256 checksums and rejects edits to already-applied migrations. The Neon schema has been applied; production DATABASE_URL still belongs in the backend host's secret environment configuration.

## Remaining backend verification and operations
- Admin editing/deletion lifecycle (rules not yet decided)
- Comment moderation/reporting and stronger abuse controls (policy not yet decided)
- Editing/deleting media and announcements (lifecycle rules not yet decided)
- B2 integration tests and live verification against the configured private bucket
- Notification delivery integration tests with real VAPID credentials and browser subscriptions
- Production monitoring/alerting and backup/restore drill
- Hosting configuration and deployment
- Pujari/admin contact workflow (not decided)
