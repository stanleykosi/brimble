# Brimble Deployment Control Plane

Local-first deployment control plane for the Brimble take-home. It is a one-page UI backed by a Fastify API/worker that accepts source code, builds it with Railpack, runs the resulting app as a Docker container, and exposes both the control plane and deployed apps through Caddy.

## What ships

- `docker compose up --build` boots the control plane stack.
- Caddy is the only ingress on host port `8080`.
- Deployments can be created from either:
  - a public Git URL
  - an uploaded `.zip`, `.tar.gz`, or `.tgz`
- Build and deploy logs stream live over SSE.
- Logs are persisted in SQLite and still render after refresh.
- Successful deployments show:
  - the built image tag
  - the current deployment status
  - the live URL served through Caddy
- The repo includes a deterministic Brimble sample and a ready-to-upload archive at [brimble-sample/brimble-sample.tgz](/home/stanley/brimble/brimble-sample/brimble-sample.tgz).

## Stack

- Backend: TypeScript, Fastify, single in-process worker/queue
- Frontend: React, Vite, TanStack Router, TanStack Query
- Persistence: SQLite
- Live logs: SSE backed by an append-only event store
- Build pipeline: `railpack prepare` + `docker buildx build --load`
- Runtime orchestration: Docker CLI
- Ingress: Caddy JSON config loaded through the admin API

## Repo layout

```text
.
├─ apps/
│  ├─ api/
│  └─ web/
├─ packages/
│  └─ contracts/
├─ infra/
│  ├─ caddy/
│  └─ docker/
├─ brimble-sample/
├─ docs/
├─ docker-compose.yml
├─ .env.example
```

## Quick start

### Prerequisites

- Docker with Compose support
- If you are running from WSL, Docker Desktop WSL integration must be enabled for that distro

No `.env` file is required for the default reviewer flow.

### Boot

```bash
docker compose up --build
```

Open:

- Control plane: `http://localhost:8080`

### Default routing mode

The default mode is hostname routing:

- `http://<deployment-slug>.localhost:8080/`

If your machine does not resolve `*.localhost` reliably, switch the default route mode before boot:

```bash
DEFAULT_ROUTE_MODE=path docker compose up --build
```

Path-mode live URLs look like:

- `http://localhost:8080/apps/<deployment-slug>/`

## Reviewer flow

### Archive deployment

1. Open `http://localhost:8080`.
2. Choose `Archive`.
3. Upload [brimble-sample/brimble-sample.tgz](/home/stanley/brimble/brimble-sample/brimble-sample.tgz).
4. Leave route mode as `Hostname` unless your environment needs `Path`.
5. Click `Create deployment`.
6. Watch the status, timeline, and log panel update live.
7. Open the live URL shown in the deployment detail panel.

### Git deployment

The control plane accepts any public `https://` Git URL. The intended deterministic demo source is the Brimble sample published as its own public repository. If that repo has not been published yet in your copy of this project, use the exact follow-up in `SUBMISSION_HANDOFF.md`.

## Architecture

### Backend

The backend in [apps/api](/home/stanley/brimble/apps/api) is both the API and the deployment worker.

- Fastify serves the control-plane API.
- SQLite stores deployments and append-only deployment events.
- `QueueService` processes deployments with default concurrency `1`, and honors `PIPELINE_MAX_CONCURRENCY` when raised.
- `PipelineService` owns the deployment state machine:
  - source acquisition
  - Railpack prepare
  - Docker Buildx image build
  - Docker runtime start
  - Caddy route load
  - health check through Caddy

### Frontend

The frontend in [apps/web](/home/stanley/brimble/apps/web) is intentionally a single-page control plane.

- One route at `/`
- create deployment form
- deployments table
- selected deployment overview
- timeline of status events
- persisted log history plus live SSE tail

### Persistence

SQLite and deployment artifacts live under `/data` in the backend container.

- DB: `/data/db/app.sqlite`
- uploads: `/data/uploads/<deployment-id>/`
- workspaces: `/data/workspaces/<deployment-id>/`

The event model is append-only. SSE subscribers receive persisted history first, then live events.

### Ingress

Caddy starts from [infra/caddy/bootstrap.json](/home/stanley/brimble/infra/caddy/bootstrap.json) and the backend later replaces the full desired config via `POST /load`.

Route ordering is:

1. control-plane API
2. path-mode app routes
3. control-plane frontend
4. hostname-mode app routes

This keeps `/api` stable and keeps deployed apps behind Caddy only.

## Configuration

Defaults are documented in [.env.example](/home/stanley/brimble/.env.example).

The main reviewer-relevant knobs are:

- `DEFAULT_ROUTE_MODE=hostname|path`
- `HOSTNAME_SUFFIX=localhost`
- `CONTROL_PLANE_PUBLIC_URL=http://localhost:8080`
- `PIPELINE_MAX_CONCURRENCY=<n>`; the default Compose path now reads this from `.env` or shell instead of forcing `1`
- `KEEP_WORKSPACES=true|false`; set `false` to remove `/data/workspaces/<deployment-id>` after terminal success or failure

## Testing and validation

### Commands used in this implementation pass


```bash
PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH pnpm install --offline --frozen-lockfile
PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH pnpm run typecheck
PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH pnpm run test
PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH pnpm run build
```

The full API Vitest suite passed: 20 test files, 52 tests.

### Docker-backed smoke test

```bash
docker version
docker compose version
docker buildx version
docker compose config
docker compose up --build -d
```

SSE logs streamed during both builds, persisted event history remained available after the streams timed out/completed, and a failed Git build preserved a useful `IMAGE_BUILD_FAILED` diagnostic. First-run Docker builds can be slow while Railpack and BuildKit warm their caches.

## Tradeoffs

- SQLite over Postgres: fewer moving parts and better odds that `docker compose up --build` works immediately.
- Default worker concurrency `1`: simpler local behavior by default, while still allowing bounded parallelism through `PIPELINE_MAX_CONCURRENCY` when needed.
- Full Caddy config replacement instead of patching subpaths: simpler and less error-prone for one control-plane writer.
- Shelling out to Docker/Git/Railpack: direct and honest for the exercise, even though a larger platform would likely wrap this more tightly.

## Security and scope limits

This is a trusted local evaluation environment, not a production PaaS.

- No auth
- No multi-tenancy
- Untrusted code is built and run locally
- The backend has Docker socket access
- No sandboxing beyond what Docker provides

Minimum hardening that is included:

- upload size limits
- archive path traversal rejection
- symlink rejection in archives
- server-side Git URL validation
- no host port publishing for deployed app containers

## Time spent

Approximate implementation time for this pass: ~14 hours.

## What I would change with more time

- move builds and app execution out of the API container into an isolated runner boundary
- add cancellation / redeploy controls
- add richer deployment health diagnostics and container log surfacing
- add stronger reconciliation tests around restart and Caddy reload failures
- publish the Brimble sample as a dedicated public repo automatically from CI

## What I would rip out before calling this production-ready

- direct Docker socket access from the control-plane API
- no-auth access to arbitrary code execution
- the nginx static wrapper if the control plane moved behind a more complete edge service
- some of the shell-out orchestration once the system grew beyond a single-machine evaluator
