# Bounty Web — Frontend

Static React + Vite SPA served via nginx, deployed on k8s `tongagent` namespace.

## Files

- `web/Dockerfile` — multi-stage build (Node 20 builder → nginx 1.27-alpine runtime)
- `web/nginx.conf` — SPA fallback, gzip, cache headers, health endpoint
- `k8s/bounty-web/deployment.yaml` — Deployment + Service + ServiceAccount
- `k8s/bounty-web/ingress.yaml` — Ingress routes (same-host and dedicated host)

## Image

`harbor.mybigai.ac.cn/tongos/bounty-web:latest`

## Build

```bash
cd web
docker build -t harbor.mybigai.ac.cn/tongos/bounty-web:latest .
docker push harbor.mybigai.ac.cn/tongos/bounty-web:latest
```

## Deploy

```bash
kubectl apply -f k8s/bounty-web/deployment.yaml
kubectl apply -f k8s/bounty-web/ingress.yaml
```

## API routing

The frontend resolves its API base in this order:
1. `VITE_API_BASE_URL` env (set at build time)
2. `window.location.origin` (same-origin via Ingress)

When deployed to `bounty.tongagents.example.com`, the existing `bounty-ingress`
still routes `/api/*` traffic to the backend (we add a frontend on top via the
new `bounty-web-ingress`). The frontend then calls `/api/*` against the same
host — works through the existing backend ingress rule as long as the rule
is path-prefix (which it is).

## Health

- Liveness / readiness: `GET /healthz` (nginx returns 200 ok)
