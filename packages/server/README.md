# @piwitests/server

Run the self-hosted [Piwi Dashboard](https://piwitests.github.io) server — a permanent
home for your Playwright test results — with a single command, no Docker required.

> **Docker is the recommended way to run Piwi in production** (pinned runtime, isolated
> environment): see the [deployment guide](https://piwitests.github.io/deployment). This
> npm package is a low-friction path for a quick local run or environments where Docker
> isn't available.

## Requirements

- Node.js **24+**

## Quick start

```bash
npx @piwitests/server
```

Then open `http://localhost:3000`.

The server creates a `.data/` directory **in your current working directory** to hold the
SQLite database (`.data/piwi.db`) and file storage (`.data/storage/` — HTML reports,
traces, attachments). Run the command from the same directory each time to keep your data,
or install it as a dependency and add a script:

```bash
npm install @piwitests/server
```

```json
{
  "scripts": {
    "piwi": "piwi-server"
  }
}
```

## Configuration

All configuration is via environment variables (same as the Docker image). Common ones:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port to listen on |
| `PIWI_SECRET_KEY` | — | Master key for encrypting secrets stored in the database (AI API keys, SCM tokens). Recommended in any real deployment. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. |
| `PIWI_AUTH_ENABLED` | — | Enable authentication (multi-user) |
| `PIWI_AUTH_SECRET` | — | Secret for encrypting session cookies (required when auth is enabled) |
| `PIWI_DATABASE_URL` | — | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/db`). When set, PostgreSQL is used instead of SQLite. |
| `PIWI_DATABASE_PATH` | `.data/piwi.db` | SQLite database path (ignored when `PIWI_DATABASE_URL` is set) |
| `PIWI_STORAGE_TYPE` | `local` | Storage backend (`local` or `s3`) |

See the [configuration reference](https://piwitests.github.io/configuration) for the full
list.

Set variables the usual way for your shell — for example, on a different port:

```bash
# Linux / macOS
PORT=8080 npx @piwitests/server
```

```powershell
# Windows (PowerShell)
$env:PORT='8080'; npx @piwitests/server
```

## Sending results

Add the [`@piwitests/reporter`](https://www.npmjs.com/package/@piwitests/reporter) to your
Playwright project and point it at this server — see the
[getting started guide](https://piwitests.github.io/getting-started).

## License

MIT
