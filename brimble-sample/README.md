# Brimble Sample

This is the deterministic demo app used by the control plane.

It is intentionally small, but it now exercises more of the deployment surface:

- no external dependencies
- listens on `process.env.PORT || 3000`
- renders a polished runtime dashboard on `/`
- returns HTTP 200 JSON on `/healthz`
- exposes runtime metadata at `/api/runtime`
- exposes backend checks at `/api/checks`
- streams live server-sent events from `/api/events`
- round-trips a small request body at `POST /api/echo`

Use cases:

- archive deployment demo by uploading `brimble-sample/brimble-sample.tgz`
- Git deployment demo after publishing this directory as its own public repository
