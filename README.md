# RunCoach AI

RunCoach AI is a monorepo MVP for a Strava-inspired running dashboard with:

- Next.js dashboard for weekly training history and workout details
- Node.js/TypeScript API for workouts and chat orchestration
- Python/FastAPI AI service for running advice based on coach principles
- AWS CDK infrastructure skeleton for deployment
- Shared TypeScript contracts under the packages folder

## Local development

1. Install dependencies:
   npm install
2. Start PostgreSQL with Docker:
   docker compose up -d
3. Start the AI service:
   python -m uvicorn apps.ai-service.main:app --reload --host 0.0.0.0 --port 8000
4. Start the API:
   npm --workspace apps/api run dev
5. Start the web app:
   npm --workspace apps/web run dev
6. Open http://localhost:3000

### Authentication

The dashboard requires an account. Google sign-in uses OAuth 2.0, and email
sign-in uses one-time magic links. For local development, the API prints the
magic link in its terminal and also returns a clickable development link.

To enable Google sign-in:

1. Copy `apps/api/.env.example` to `apps/api/.env`.
2. Create a Google OAuth 2.0 Web application client.
3. Add `http://localhost:4000/auth/google/callback` as an authorized redirect URI.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `apps/api/.env`.

Each account has its own workouts. Existing seeded workouts are assigned to the
internal demo user and are not exposed to newly created accounts.

### Strava synchronization

Create an API application at https://www.strava.com/settings/api and set these
values in `apps/api/.env`:

- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_TOKEN_ENCRYPTION_KEY` (a long random secret)

Set the Strava app's Authorization Callback Domain to `localhost` for local
development. The callback URL used by the API is
`http://localhost:4000/strava/callback`. After signing in, click **Synchronize
Strava account**. The first click connects the account; later clicks import the
user's running activities and refresh the training history. Imported activities
are deduplicated per user.

## Docker development

Docker Desktop must be running. Start the complete stack with:

docker compose up --build

This starts PostgreSQL, the Python AI service, the Node API, and the Next.js
web app. Open http://localhost:3000. Stop the stack with:

docker compose down

The PostgreSQL data volume is preserved between runs. To reset it completely:

docker compose down -v

The API uses `postgresql://runcoach:runcoach@localhost:5432/runcoach` by default.
To use a different database, copy `apps/api/.env.example` to `apps/api/.env` and
set `DATABASE_URL`.

Stop PostgreSQL when finished:

    docker compose down

To remove the persisted database volume as well:

    docker compose down -v

## Default data

The MVP ships with synthetic training data. The API seeds that data into PostgreSQL
the first time the database is empty, and manual workouts are persisted there.

## Notes

This is an MVP, so Strava syncing is represented as a mock integration and manual workout creation is included to keep the app functional without external services.
