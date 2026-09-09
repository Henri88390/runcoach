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
3. Build the cross-platform AI training image:
   docker compose build ai-trainer
4. Train the local coach adapter:
   docker compose --profile training run --rm ai-trainer
5. Start the AI service:
   docker compose up ai-service
6. Start the API:
   npm --workspace apps/api run dev
7. Start the web app:
   npm --workspace apps/web run dev
8. Open http://localhost:3000

For a consistent environment across Windows, macOS, and Linux, use the Docker
training workflow below instead of importing PyTorch from the host `.venv`.

### Local coach model

Coach chat uses a local open-weight model and a LoRA adapter by default. `train.py`
uses the source-linked SQLite coach knowledge database to train the adapter,
while chat retrieval still limits each answer to the selected coaches and
returns citations. The default base model is `Qwen/Qwen2.5-0.5B-Instruct`; set
`LOCAL_MODEL_NAME` to use another compatible Hugging Face causal language model.
Set `LOCAL_ADAPTER_PATH` to change where the trained adapter is saved and loaded.

### OpenAI provider (optional)

Coach chat can also answer using the OpenAI API instead of the local model. The
chat panel shows a friendly "Local model" / "OpenAI" selector, backed by
`GET /chat/providers`, which the AI service reports as available only when an
OpenAI key is configured. Both providers reuse the same coach knowledge
retrieval and citations; only the generation step changes.

To enable it:

1. Add `OPENAI_API_KEY` and `OPENAI_MODEL` to the single `.env` file in the
   repository root (next to `docker-compose.yml`; it is git-ignored, copy it
   from `.env.example` if it does not exist yet). The API server and Docker
   Compose both read this one file:

   ```env
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4o-mini
   ```

   Docker Compose automatically loads this file and substitutes
   `${OPENAI_API_KEY:-}` / `${OPENAI_MODEL:-gpt-4o-mini}` in `docker-compose.yml`.
   If you run the AI service directly with uvicorn instead of Docker, export the
   same variables in that shell before starting it.

2. Rebuild and recreate the `ai-service` container so it picks up the new
   `openai` dependency and code, plus the new environment variables:

   ```powershell
   docker compose up -d --build ai-service
   ```

   An env-only change still requires this rebuild here because the Dockerfile
   copies the service source into the image; env vars alone are not enough
   until the image also contains the OpenAI integration code.

3. Confirm it is available:

   ```powershell
   Invoke-WebRequest http://localhost:8000/providers
   ```

   `openai` should report `"available": true`. Selecting it in the chat UI sets
   `generationMode: "openai"` on responses instead of `local_llm`.

#### How the local LLM works

The system combines four parts:

1. A pre-trained base language model: `Qwen/Qwen2.5-0.5B-Instruct`.
2. A small LoRA adapter trained for running-coach responses.
3. A SQLite knowledge base containing concise, source-linked coach principles.
4. Retrieval that filters knowledge by the coaches selected in the chat UI.

The project does not train the base language model from zero. The base model
already understands language and instructions. Training adapts it to this
application using the coach data.

LoRA means Low-Rank Adaptation. Instead of changing every parameter in the base
model, training adds small trainable matrices to selected attention layers:

```text
Original weights: W
LoRA update:      A x B
Effective weights: W + A x B
```

Only the LoRA parameters are trained. The original model remains unchanged,
which makes training faster and the resulting adapter much smaller.

The training flow is:

```text
Coach records in SQLite
   -> training examples
   -> base Qwen model + LoRA layers
   -> trained adapter and checkpoints
```

At runtime, a chat request follows this path:

```text
User question + selected coaches
   -> retrieve matching coach records
   -> local Qwen model + LoRA adapter
   -> answer with source citations
```

The Node API forwards the request to the Python service. The Python service
retrieves only records belonging to the selected coaches, gives those passages
to the local model, and returns the answer together with the source title,
coach, and URL. Citations come from the knowledge database; the model does not
independently verify source URLs.

The current dataset is a small technical proof of concept with one concise
record per coach. It is not enough to create a complete expert running model.
For better results, add legally usable, source-linked examples covering easy
runs, long runs, intervals, recovery, marathon preparation, periodization,
race preparation, and different runner experience levels. Do not copy entire
copyrighted books into the repository.

Training a foundation model from scratch would require a much larger licensed
dataset and dedicated GPU infrastructure. This project uses local adapter
fine-tuning plus retrieval instead.

#### Train the local adapter

The recommended cross-platform workflow is:

```powershell
docker compose build ai-trainer
docker compose --profile training run --rm ai-trainer
```

The trained adapter is stored in the persistent `ai-models` Docker volume and
is automatically available to the `ai-service` container. Start that service
with:

```powershell
docker compose up ai-service
```

This uses Linux containers, so Windows DLL and Python installation policies do
not affect PyTorch. Docker Desktop must be installed and running. CPU training
works everywhere but may be slow; a separate Linux GPU runner should be used
for larger models or frequent retraining.

For interactive chat, the Docker service enables local-model CPU inference by
default with a short response limit. CPU generation may still take longer than
the grounded fallback. Set `LOCAL_LLM_ON_CPU: "false"` in the `ai-service`
environment to return the instant fallback instead. Local generation has a
ten-second timeout (`LOCAL_LLM_TIMEOUT_SECONDS`); if it is exceeded, chat
immediately returns the history-aware grounded fallback instead of waiting.
The default local generation budget is 32 output tokens and 384 input tokens,
which keeps responses short enough for mixed hardware while preserving the
fallback as the hard latency guarantee.

The first training run downloads the base model from Hugging Face. The adapter
is small and can be retrained without modifying the base model. Updating the
coach knowledge records and rerunning the training command rebuilds the adapter
from the current source-linked data. Docker persists the downloaded Hugging Face
model in the `hf-cache` volume, so later restarts do not download it again. The
Docker services disable Hugging Face Xet transfers for more reliable resumable
downloads across developer machines.

#### Add training data and retrain

1. Add source-linked records to `apps/ai-service/knowledge.py` in
   `COACH_RESOURCES`. Each record should identify the coach, a focused topic,
   the source URL, and an original concise summary:

   ```python
   KnowledgeChunk(
       coach="Coach name",
       title="Source title or topic",
       url="https://example.com/source",
       content=(
           "An original summary of one specific training principle. "
           "Explain when it applies and how a runner might use it."
       ),
   )
   ```

2. Prefer several focused records per coach instead of one large passage. Cover
   topics such as easy running, long runs, intervals, recovery, pacing,
   periodization, race preparation, fatigue, and different experience levels.
   Keep the writing in your own words, use sources you are allowed to store,
   and never copy entire copyrighted books or articles into the repository.

3. Retrain from a clean adapter after changing the records. This removes old
   checkpoints so the new dataset is used from the beginning:

   ```powershell
   docker compose build ai-trainer
   docker compose run --rm --no-deps ai-trainer sh -lc "rm -rf models/runcoach-coach-lora"
   docker compose --profile training run --rm ai-trainer
   ```

   The default training profile balances quality and speed: one epoch, up to 20
   varied examples, 256-token examples, and four CPU threads. To run a larger training
   pass, override the settings in the shell before starting the container:

   ```powershell
   $env:TRAIN_EPOCHS = "3"
   $env:TRAIN_MAX_LENGTH = "512"
   $env:TRAIN_MAX_EXAMPLES = "0"
   docker compose --profile training run --rm ai-trainer
   ```

   `TRAIN_MAX_EXAMPLES` limits the number of generated examples; `0` means use
   all examples. For the fastest smoke test, set it to `5` and use one epoch.

   The trainer creates multiple question-and-answer examples from the coach
   records. It saves checkpoints and the final LoRA adapter in the persistent
   `ai-models` Docker volume. If training is interrupted, rerunning the command
   resumes from the newest checkpoint. Use the clean reset command above when
   the dataset or training code has changed substantially.

   `ai-trainer` is a one-off job, not a long-running service, so there is
   nothing to "restart" — rerunning the same command is how you apply new
   `docker-compose.yml` changes to it:

   ```powershell
   docker compose --profile training up --build ai-trainer
   ```

   You will not lose existing training progress by doing this. Checkpoints and
   the trained adapter live in the persistent `ai-models` volume, not in the
   container itself, and `train.py` auto-resumes from the newest checkpoint
   found there. Only deleting that volume (or the checkpoint folder, as in the
   clean-reset command above) discards prior training.

4. Rebuild and restart the inference service so it loads the new adapter:

   ```powershell
   docker compose build ai-service
   docker compose up -d --force-recreate ai-service
   ```

   Do not run `docker compose down -v` during this process. The `ai-models`
   volume contains the trained adapter and `hf-cache` contains the downloaded
   base model. Removing those volumes forces a full retrain and model download.

5. Confirm the service is running and the coach data is available:

   ```powershell
   Invoke-WebRequest http://localhost:8000/health
   Invoke-WebRequest http://localhost:8000/coaches
   Invoke-WebRequest http://localhost:8000/model-status
   ```

   The model-status response should eventually contain `"status":"ready"`.
   During the first startup, watch the loading process with:

   ```powershell
   docker compose logs -f ai-service
   ```

   Wait for `Local coach model loaded and ready` before expecting local-LLM
   responses. `"status":"error"` means the service will use the grounded
   fallback and the error field explains why.

   The chat UI will still show `Grounded knowledge fallback` on CPU-only
   deployments unless `LOCAL_LLM_ON_CPU: "true"` is enabled. That fallback now
   synthesizes an answer from the selected coach records. `Generated by local
   LLM` means the trained adapter and local model generated the response.

Host-based workflow, useful only when the local Python environment allows
PyTorch, is:

From the repository root, run:

```powershell
.venv\Scripts\pip.exe install -r apps\ai-service\requirements.txt
.venv\Scripts\python.exe apps\ai-service\train.py
```

Training reads the source-linked coach records. Keep source URLs with each
record so responses can cite the coach guidance.

To use a different compatible model or output directory:

```powershell
$env:LOCAL_MODEL_NAME = "Qwen/Qwen2.5-0.5B-Instruct"
$env:LOCAL_ADAPTER_PATH = "models/my-runcoach-adapter"
.venv\Scripts\python.exe apps\ai-service\train.py
```

Add or update source-linked coach material in `apps/ai-service/knowledge.py`,
then run the training command again. Keep the source URL with each record so
responses can cite the coach guidance. Use material you are legally allowed to
store and train on; do not copy entire copyrighted books into the repository.

Start the service after training:

```powershell
.venv\Scripts\python.exe -m uvicorn main:app --app-dir apps\ai-service --reload --host 0.0.0.0 --port 8000
```

This is local adapter fine-tuning, not foundation-model pretraining from zero.
Training a foundation model requires a much larger licensed dataset and
dedicated GPU infrastructure.

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

docker compose up --build

This starts PostgreSQL, the Python AI service, the Node API, and the Next.js
web app. Open http://localhost:3000. Stop the stack with:

docker compose down

The PostgreSQL data volume is preserved between runs. To reset it completely:

docker compose down -v

The API uses `postgresql://runcoach:runcoach@localhost:5432/runcoach` by default.
To use a different database, copy `.env.example` to `.env` in the repository root
and set `DATABASE_URL`.

Stop PostgreSQL when finished:

    docker compose down

To remove the persisted database volume as well:

    docker compose down -v

## Default data

The MVP ships with synthetic training data. The API seeds that data into PostgreSQL
the first time the database is empty, and manual workouts are persisted there.

## Notes

This is an MVP, so Strava syncing is represented as a mock integration and manual workout creation is included to keep the app functional without external services.
