"""FastAPI application entrypoint."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.core.config import get_settings
from app.core.db import dispose_engine
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.redis import close_redis
from app.core.telemetry import init_telemetry
from app.modules.auth.router import router as auth_router
from app.modules.change import change_router
from app.modules.health import health_router
from app.modules.agent.router import router as agent_router
from app.modules.scan_docs.router import router as scan_docs_router
from app.modules.git_identity import git_identity_router
from app.modules.task import task_router
from app.modules.worktree import lease_router, worktree_router
from app.modules.workspace import workspace_router
from app.modules.git_gateway.router import router as git_gateway_router
from app.modules.change_writer.router import router as change_writer_router
from app.modules.workflow.router import router as workflow_router
from app.modules.incident.router import router as incident_router
from app.modules.knowledge.router import router as knowledge_router
from app.modules.release.router import router as release_router
from app.modules.runtime.router import router as runtime_router
from app.modules.tool_gateway.router import router as tool_gateway_router
from app.modules.archive.router import router as archive_router
from app.modules.settings.router import router as settings_router
from app.modules.spec_workspace.router import router as spec_workspace_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    init_telemetry(settings)
    log = get_logger(__name__)
    log.info(
        "app.start",
        version=__version__,
        environment=settings.environment,
        commit=settings.resolved_commit_sha,
    )
    try:
        # Bootstrap auth once the DB connection pool exists.
        from app.core.db import get_session_factory
        from app.modules.auth.service import bootstrap_admin_and_seed_rbac

        factory = get_session_factory()
        async with factory() as session:
            await bootstrap_admin_and_seed_rbac(session, settings=settings)
        yield
    finally:
        log.info("app.shutdown")
        await dispose_engine()
        await close_redis()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Multi-Agent Platform API",
        version=__version__,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-request-id"],
    )

    @app.middleware("http")
    async def request_id_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        rid = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = rid
        response: Response = await call_next(request)
        response.headers["x-request-id"] = rid
        return response

    register_exception_handlers(app)

    app.include_router(health_router, prefix="/api")
    app.include_router(workspace_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(change_router, prefix="/api")
    app.include_router(scan_docs_router, prefix="/api")
    app.include_router(task_router, prefix="/api")
    app.include_router(git_identity_router, prefix="/api")
    app.include_router(agent_router, prefix="/api")
    app.include_router(worktree_router, prefix="/api")
    app.include_router(lease_router, prefix="/api")
    app.include_router(git_gateway_router, prefix="/api")
    app.include_router(change_writer_router, prefix="/api")
    app.include_router(workflow_router, prefix="/api")
    app.include_router(incident_router, prefix="/api")
    app.include_router(knowledge_router, prefix="/api")
    app.include_router(release_router, prefix="/api")
    app.include_router(runtime_router, prefix="/api")
    app.include_router(tool_gateway_router, prefix="/api")
    app.include_router(archive_router, prefix="/api")
    app.include_router(settings_router, prefix="/api")
    app.include_router(spec_workspace_router, prefix="/api")

    return app


app = create_app()
