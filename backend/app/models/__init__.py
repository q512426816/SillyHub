"""Shared SQLModel base.

Concrete tables live in feature modules under ``app/modules/<feature>/model.py``
— they're registered with Alembic via ``backend/migrations/env.py``, not here,
to avoid circular imports between ``app.models`` and feature modules.
"""

from app.models.base import BaseModel

__all__ = ["BaseModel"]
