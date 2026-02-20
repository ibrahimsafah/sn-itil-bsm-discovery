# SN ITIL BSM Discovery

## Requirements

- Python 3.9+ (for backend)

## Backend (Dead-Simple)

A tiny backend is provided at `backend/server.py`.

It:

- Serves the static frontend from `dist/`
- Exposes:
  - `GET /api/health`
  - `GET /api/sample-graph`

### Run backend

```bash
python3 backend/server.py
```

Optional overrides:

- `--host 0.0.0.0`
- `--port 3000`
- `--root dist`

You can also use env vars:

- `PORT`
- `BACKEND_ROOT`

### Verify

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/sample-graph
```

Then open:

- `http://127.0.0.1:3000/bsm-discovery.html`

## Notes

- This backend is intentionally minimal and intended for local development only.
