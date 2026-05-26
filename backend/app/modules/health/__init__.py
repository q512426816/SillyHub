"""Health & version endpoints. Mounted at /api in app.main."""

from app.modules.health.router import router as health_router

__all__ = ["health_router"]
