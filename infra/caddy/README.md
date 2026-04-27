# Caddy bootstrap

`bootstrap.json` is the minimal starting config for the control plane.

It does two things:

1. expose the Caddy admin API on the internal Docker network only
2. route `localhost` / `127.0.0.1` traffic to:
   - `backend` for `/api*`
   - `frontend` for everything else

After startup, the backend replaces the active config through Caddy's admin
`/load` endpoint so running deployments can be routed dynamically. The Compose
service starts Caddy with `--resume` and the mounted `/config` volume, so an
independent Caddy container restart restores the autosaved dynamic config instead
of dropping back to this bootstrap-only route set.
