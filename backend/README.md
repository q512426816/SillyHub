# Backend — `multi-agent-platform-api`

FastAPI (Python 3.12) + SQLModel + Alembic + Redis. See `../README.md` for the
30-minute getting-started guide; this file lists backend-specific commands.

## Quick commands

```bash
cd backend
uv sync --all-extras                    # install deps (incl. dev)
cp .env.example .env                    # adjust DATABASE_URL etc.
uv run alembic upgrade head             # run migrations
uv run uvicorn app.main:app --reload    # serve on :8000
```

## Tests / lint

```bash
uv run pytest -q --cov=app --cov-fail-under=60
uv run ruff check . && uv run ruff format --check .
uv run mypy app
```

## Layout

```
app/
├─ core/      Config, db engine, redis client, structured logging, error handlers
├─ modules/   Vertical feature slices (one router + schema + service per module)
└─ models/    SQLModel base + shared mixins
migrations/   Alembic env + versioned migrations
tests/        Pytest suites (one test_*.py per module)
```

## Conventions

- Async-first. Sync code only in CLI / migrations.
- Routes live in `app/modules/<feature>/router.py`. Aggregate them in `app/main.py`.
- Settings are immutable; read once via `get_settings()` (cached).
- Use structlog; never `print` from app code.
- Error responses follow `{code, message, request_id, details}` (see
  `references/18-error-recovery.md`).
