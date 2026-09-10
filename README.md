# RunCoach AI

RunCoach AI is a monorepo MVP for a Strava-inspired running dashboard with:

- Next.js dashboard for weekly training history and workout details
- Node.js/TypeScript API for workouts and chat orchestration
- Python/FastAPI AI service for running advice based on coach principles
- Shared TypeScript contracts under the packages folder

## Local development

1. Install dependencies:
   `npm install`
2. Configure OpenAI in a repository-root `.env` file:

   ```env
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4o-mini
   ```

3. Start PostgreSQL and the AI service:
   `docker compose up -d --build`
4. Start the API:
   `npm --workspace apps/api run dev`
5. Start the web app:
   `npm --workspace apps/web run dev`
6. Open http://localhost:3000.

### Coach chat

Coach chat retrieves source-linked guidance for the coaches selected in the UI
and includes the runner's recent training history. It uses OpenAI to synthesize
the response and preserves source citations. If `OPENAI_API_KEY` is absent, the
request times out, or OpenAI returns an unusable response, it produces a
history-aware grounded answer from the same coach knowledge instead.

`OPENAI_TIMEOUT_SECONDS` controls the maximum OpenAI response time and defaults
to 15 seconds. Rebuild the `ai-service` after changing its code or dependencies:

```powershell
docker compose up -d --build ai-service
```

The API limits each account to 20 coach-chat requests per day by default. Set
`CHAT_DAILY_LIMIT` in the repository-root `.env` to change that allowance.

Add source-linked coach material in `apps/ai-service/knowledge.py`. Keep
summaries original and concise, use sources you are allowed to store, and do
not copy entire copyrighted books or articles into the repository.

### Authentication

The dashboard requires an account. Google sign-in uses OAuth 2.0, and email
sign-in uses one-time magic links. For local development, the API prints the
magic link in its terminal and also returns a clickable development link.

To enable Google sign-in:

1. Copy `.env.example` to `.env` in the repository root.
2. Create a Google OAuth 2.0 Web application client.
3. Add `http://localhost:4000/auth/google/callback` as an authorized redirect URI.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.

Each account has its own workouts. Existing seeded workouts are assigned to the
internal demo user and are not exposed to newly created accounts.

### Strava synchronization

Create an API application at https://www.strava.com/settings/api and set these
values in `.env`:

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

```powershell
docker compose up --build
```

This starts PostgreSQL and the Python AI service. Start the Node API and Next.js
web app with the local-development commands above. Stop the Docker services
with `docker compose down`.

The PostgreSQL data volume is preserved between runs. To reset it completely:

```powershell
docker compose down -v
```

The API uses `postgresql://runcoach:runcoach@localhost:5432/runcoach` by default.
To use a different database, copy `.env.example` to `.env` in the repository root
and set `DATABASE_URL`.

## Container deployment

The web app, API, and AI service each have a production Docker image. Local
Compose runs all three services plus PostgreSQL:

```powershell
docker compose up --build
```

The `develop` branch deploys immutable commit-tagged images through
`.github/workflows/deploy-dev.yml`. The workflow publishes images to GitHub
Container Registry, then updates the application services on a Docker host
over SSH. PostgreSQL is expected to be managed separately for deployments.

Configure the GitHub `development` environment with these secrets:

- `DEV_HOST`, `DEV_USER`, `DEV_SSH_KEY`, and `DEV_DEPLOY_PATH`
- `GHCR_PULL_TOKEN` with permission to read packages

The deployment host must have Docker Compose v2, a `.env` file at
`DEV_DEPLOY_PATH`, and a writable deployment directory. Its `.env` must define
`DATABASE_URL`, `WEB_URL`, and `API_PUBLIC_URL`, along with the application
secrets listed in `.env.example`. Configure `DEV_WEB_URL` and `DEV_API_URL` as
GitHub environment variables for the final smoke tests. The web image receives
`DEV_API_URL` as its build-time `NEXT_PUBLIC_API_BASE_URL` value.

Create the branch and trigger the first deployment with:

```powershell
git switch -c develop
git push -u origin develop
```

## Default data

The MVP ships with synthetic training data. The API seeds that data into PostgreSQL
the first time the database is empty, and manual workouts are persisted there.

## Notes

This is an MVP, so Strava syncing is represented as a mock integration and manual
workout creation is included to keep the app functional without external services.
