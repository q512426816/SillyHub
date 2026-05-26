# syntax=docker/dockerfile:1.7
# Multi-stage build for the FastAPI backend.
# Stage 1: install dependencies with uv into an isolated venv.
# Stage 2: copy the venv + source into a slim runtime.

ARG PYTHON_VERSION=3.12

FROM python:${PYTHON_VERSION}-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv

# uv: single-binary, fast python package manager
RUN pip install --no-cache-dir --upgrade pip uv==0.4.18

WORKDIR /build

# pyproject.toml references README.md as the long_description, so both files
# must be present before `uv pip install -e .` runs.
COPY pyproject.toml README.md ./
# Lock-less install is acceptable for V1; once we add uv.lock, switch to `uv sync --frozen`.
RUN uv venv /opt/venv \
 && uv pip install --python /opt/venv/bin/python --no-cache -e .

COPY . .


FROM python:${PYTHON_VERSION}-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:${PATH}"

# Non-root runtime user
RUN groupadd --system app && useradd --system --gid app --home /app app

# Install minimal runtime dependencies (libpq for asyncpg/psycopg fallback if ever needed)
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /build /app

RUN chown -R app:app /app
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
