---
title: Deployment
lang: en-US
---

# Deployment

## Docker (recommended)

### Quick start

::: code-group

```bash [Linux / macOS]
docker pull phenx/piwitests-server:latest
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data phenx/piwitests-server:latest
```

```powershell [Windows (PowerShell)]
docker pull phenx/piwitests-server:latest
docker run -p 3000:3000 -v ${PWD}/.data:/app/.data phenx/piwitests-server:latest
```

:::

The dashboard will be available at `http://localhost:3000`.

### Available tags

| Tag | Description |
|-----|-------------|
| `latest` | Latest stable release |
| `0.9.0` | Specific version (semver) |
| `0.9` | Latest patch of a minor version |
| `0` | Latest release of the major version |

Pin a specific version in production; [tags on Docker Hub](https://hub.docker.com/r/phenx/piwitests-server/tags).

### Image details

| Property | Value |
|----------|-------|
| Base image | `node:24-alpine` |
| Build type | Multistage (builder + production stages) |
| Image size | ~400 MB |
| Platforms | `linux/amd64`, `linux/arm64` |
| Registry | `phenx/piwitests-server` |

### Volumes

Mount a volume to persist data:

```bash
docker run -p 3000:3000 -v /path/to/data:/app/.data phenx/piwitests-server:latest
```

> On Windows, use a host path like `C:\piwi\data` (PowerShell) in place of `/path/to/data`.

The `.data` directory contains:

- `piwi.db` — SQLite database
- `storage/` — HTML reports and trace files

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Set automatically |
| `HOST` | `0.0.0.0` | Listen on all interfaces |
| `PORT` | `3000` | Application port |
| `PIWI_SECRET_KEY` | — | Master key for encrypting secrets in the database (AI API keys, SCM tokens). Recommended in all deployments. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` (or `openssl rand -hex 32`). |
| `PIWI_AUTH_ENABLED` | — | Enable authentication |
| `PIWI_AUTH_SECRET` | — | Secret for encrypting session cookies (required if auth enabled). Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` (or `openssl rand -hex 32`). |
| `PIWI_STORAGE_TYPE` | `local` | Storage backend (`local` or `s3`) |
| `PIWI_DATABASE_URL` | — | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/db`). When set, PostgreSQL is used instead of SQLite. |
| `PIWI_DATABASE_PATH` | `.data/piwi.db` | SQLite database path (ignored when `PIWI_DATABASE_URL` is set) |

## Building locally

Build from the repository root (the `Dockerfile` lives there):

::: code-group

```bash [Linux / macOS]
docker build -t piwi-dashboard:local .
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data piwi-dashboard:local
```

```powershell [Windows (PowerShell)]
docker build -t piwi-dashboard:local .
docker run -p 3000:3000 -v ${PWD}/.data:/app/.data piwi-dashboard:local
```

:::

## Docker Compose

The repository ships a ready-to-use [`docker-compose.yml`](https://github.com/PiwiTests/platform/blob/main/docker-compose.yml) with commented options (secret key, auth, PostgreSQL). Minimal version:

```yaml
services:
  piwi-dashboard:
    image: phenx/piwitests-server:latest
    ports:
      - "3000:3000"
    volumes:
      - ./.data:/app/.data
    restart: unless-stopped
```

Run with:

```bash
docker compose up -d
```

### Docker Compose with PostgreSQL

For production deployments requiring a robust relational database:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: piwi
      POSTGRES_PASSWORD: change-me
      POSTGRES_DB: piwi
    volumes:
      - pg-data:/var/lib/postgresql/data
    restart: unless-stopped

  piwi-dashboard:
    image: phenx/piwitests-server:latest
    ports:
      - "3000:3000"
    volumes:
      - ./.data:/app/.data   # still used for report/trace file storage
    environment:
      - PIWI_DATABASE_URL=postgresql://piwi:change-me@postgres:5432/piwi
    depends_on:
      - postgres
    restart: unless-stopped

volumes:
  pg-data:
```

Run with:

```bash
docker compose up -d
```

## Kubernetes

Example deployment manifest:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: piwi-dashboard
spec:
  replicas: 1
  selector:
    matchLabels:
      app: piwi-dashboard
  template:
    metadata:
      labels:
        app: piwi-dashboard
    spec:
      containers:
      - name: piwi-dashboard
        image: phenx/piwitests-server:latest
        ports:
        - containerPort: 3000
        readinessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 20
          periodSeconds: 30
        volumeMounts:
        - name: data
          mountPath: /app/.data
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: piwi-dashboard-data
---
apiVersion: v1
kind: Service
metadata:
  name: piwi-dashboard
spec:
  selector:
    app: piwi-dashboard
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

## Production build from source

```bash
cd application
npm install
npm run app:build
npm run app:preview  # preview the production build locally
```

## Health checks

`GET /api/health` verifies database connectivity and returns `200 {"status":"ok"}` when healthy, `503` otherwise — use it for load-balancer targets, uptime monitors, and container orchestration. The Docker image ships a built-in `HEALTHCHECK` against it, so `docker ps` shows `healthy`/`unhealthy` out of the box. `GET /api/version` additionally reports the running version and database backend.

## Reverse proxy (HTTPS)

Always put a TLS-terminating reverse proxy in front of the dashboard for anything beyond localhost. Two working examples — mind the **upload size** (trace/report uploads can reach hundreds of MB) and **SSE streaming** (live runs and browser notifications use long-lived `text/event-stream` responses that must not be buffered).

**Caddy** (automatic HTTPS):

```text
piwi.example.com {
    reverse_proxy localhost:3000
}
```

**nginx:**

```nginx
server {
    listen 443 ssl;
    server_name piwi.example.com;

    # ssl_certificate     /etc/letsencrypt/live/piwi.example.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/piwi.example.com/privkey.pem;

    client_max_body_size 500m;   # trace + report uploads

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Live streaming + notifications use Server-Sent Events:
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
```

When auth is enabled, set `PIWI_SITE_URL` to the public HTTPS URL so email links and OAuth callbacks point at the right origin.

## Backups

Everything lives in two places — back both up:

1. **The database** — SQLite file `.data/piwi.db` (default) or your PostgreSQL database (`pg_dump`).
2. **File storage** — `.data/storage/` (HTML reports, traces, attachments), unless you use [S3 storage](/storage).

With the default SQLite + local storage setup, a consistent backup is simply a copy of `.data/` while the container is stopped — or use SQLite's online backup to avoid downtime:

::: code-group

```bash [Linux / macOS]
# Online, consistent SQLite backup + storage copy
sqlite3 .data/piwi.db ".backup '.data/piwi-backup.db'"
tar czf piwi-backup.tar.gz -C .data piwi-backup.db storage
```

```powershell [Windows (PowerShell)]
# Stop the container first for a consistent copy, then:
Compress-Archive -Path .data -DestinationPath piwi-backup.zip
```

:::

With PostgreSQL: `pg_dump` the database and copy `.data/storage/` (or rely on your S3 bucket's own durability/versioning).

## Resource requirements

Piwi is a single Node.js process and runs comfortably on small machines:

| Deployment | Guideline |
|---|---|
| RAM | ~300 MB idle; 1 GB is comfortable headroom for large uploads and AI diagnosis |
| CPU | 1 vCPU is enough for a team; ingest is I/O-bound |
| Disk | The real variable — traces and HTML reports dominate. Budget by retention: e.g. ~50–200 MB per run with traces enabled. Prune old runs from **Settings → Storage** |
| Scaling | Run a single replica. SQLite requires it; with PostgreSQL the SSE event bus is still in-process, so keep one instance |

## Security

The container runs as a non-root user (`nodejs:nodejs`, UID/GID 1001).

Security best practices:

- Always use HTTPS in production
- Mount `.data/` on a persistent volume
- Set a strong `PIWI_SECRET_KEY` (`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, or `openssl rand -hex 32`) to encrypt secrets at rest
- Set a strong `PIWI_AUTH_SECRET` and enable authentication for multi-user deployments

## Troubleshooting

### Permission issues with volumes

On **Linux hosts**, the bind-mounted directory must be writable by the container's UID 1001:

```bash
mkdir -p .data
chmod 777 .data
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data phenx/piwitests-server:latest
```

> On Windows and macOS, Docker Desktop manages volume permissions automatically — no `chmod` is needed. Just run the container with `-v ${PWD}/.data:/app/.data` (PowerShell).

### Database locked

SQLite doesn't support concurrent writes well. For high-concurrency deployments, run a single instance or switch to PostgreSQL by setting `PIWI_DATABASE_URL`.

### Port already in use

Map to a different host port:

::: code-group

```bash [Linux / macOS]
docker run -p 8080:3000 -v $(pwd)/.data:/app/.data phenx/piwitests-server:latest
```

```powershell [Windows (PowerShell)]
docker run -p 8080:3000 -v ${PWD}/.data:/app/.data phenx/piwitests-server:latest
```

:::

The dashboard will be available at `http://localhost:8080`.
