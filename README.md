# Mankaleshwar Mahadev Backend

TypeScript API service for the Mankaleshwar Mahadev Temple website.

## Current foundation

- Fastify 5 HTTP server
- Strict TypeScript configuration
- Environment validation with Zod
- Security headers with Helmet
- Explicit CORS allowlist
- Global rate limiting
- Structured logging with sensitive header redaction
- Versioned health endpoint: `GET /api/v1/health`
- Graceful shutdown on SIGINT and SIGTERM

## Requirements

- Node.js 22 or newer
- npm

## Run locally

1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Start development mode with `npm run dev`.

## Available commands

- `npm run dev` — development server with reload
- `npm run typecheck` — TypeScript type checking
- `npm run build` — compile to `dist/`
- `npm start` — run compiled server

The API listens on port 4000 by default.

## Scope decisions intentionally deferred

The repository requirements leave several product and provider decisions open. This foundation does not invent those decisions. Database selection and schema, admin authentication and permissions, comment moderation and abuse controls, notification delivery, and media storage integration must be designed before their corresponding features are implemented.

## API

### Health

`GET /api/v1/health`

Returns the service status and timestamp. This is a process-level health check; it does not yet verify database, storage, or notification-provider connectivity.
