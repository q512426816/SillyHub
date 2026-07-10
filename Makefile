# Multi-Agent Platform — top-level Makefile
# All commands are designed to work on Linux / macOS and on Windows via Git Bash.

.PHONY: help dev-up dev-down dev-logs dev-reset \
        backend-install backend-run backend-test backend-lint backend-format backend-migrate \
        frontend-install frontend-run frontend-test frontend-lint frontend-typecheck frontend-build \
        test lint up down logs

help:
	@echo "Targets:"
	@echo "  dev-up            Start postgres + redis via docker compose (deploy/docker-compose.dev.yml)"
	@echo "  dev-down          Stop dev dependencies"
	@echo "  dev-logs          Tail dev dependencies' logs"
	@echo "  dev-reset         Wipe pg/redis volumes (DESTRUCTIVE)"
	@echo "  backend-install   Sync backend deps via uv"
	@echo "  backend-run       Run backend with reload"
	@echo "  backend-test      Pytest"
	@echo "  backend-lint      Ruff check + format --check + mypy"
	@echo "  backend-format    Ruff format"
	@echo "  backend-migrate   alembic upgrade head"
	@echo "  frontend-install  pnpm install"
	@echo "  frontend-run      pnpm dev"
	@echo "  frontend-test     pnpm test --run"
	@echo "  frontend-lint     pnpm lint"
	@echo "  frontend-typecheck pnpm typecheck"
	@echo "  frontend-build    pnpm build"
	@echo "  test              Run backend + frontend tests"
	@echo "  lint              Run backend + frontend lint"
	@echo "  up                docker compose -f deploy/docker-compose.yml up --build"
	@echo "  down              docker compose -f deploy/docker-compose.yml down"
	@echo "  logs              docker compose -f deploy/docker-compose.yml logs -f"

dev-up:
	docker compose -f deploy/docker-compose.dev.yml up -d

dev-down:
	docker compose -f deploy/docker-compose.dev.yml down

dev-logs:
	docker compose -f deploy/docker-compose.dev.yml logs -f

dev-reset:
	docker compose -f deploy/docker-compose.dev.yml down -v

backend-install:
	cd backend && uv sync --all-extras

backend-run:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

backend-test:
	cd backend && uv run pytest -q --cov=app --cov-fail-under=60

backend-lint:
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app

backend-format:
	cd backend && uv run ruff format . && uv run ruff check . --fix

backend-migrate:
	cd backend && uv run alembic upgrade head

frontend-install:
	cd frontend && pnpm install

frontend-run:
	cd frontend && pnpm dev

frontend-test:
	cd frontend && pnpm test

frontend-lint:
	cd frontend && pnpm lint

frontend-typecheck:
	cd frontend && pnpm typecheck

frontend-build:
	cd frontend && pnpm build

daemon-install:
	cd sillyhub-daemon && pnpm install

daemon-test:
	cd sillyhub-daemon && pnpm test

daemon-typecheck:
	cd sillyhub-daemon && pnpm typecheck

daemon-build:
	cd sillyhub-daemon && pnpm build

test: backend-test frontend-test daemon-test

lint: backend-lint frontend-lint daemon-typecheck

build: frontend-build daemon-build

up:
	docker compose -f deploy/docker-compose.yml up --build

down:
	docker compose -f deploy/docker-compose.yml down

logs:
	docker compose -f deploy/docker-compose.yml logs -f
