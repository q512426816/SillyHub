"""Shared SQLModel base + metadata.

Concrete tables live in feature modules (``app/modules/<feature>/models.py``)
and inherit from :class:`BaseModel` so they all share the same metadata object
— which is what Alembic autogenerate scans.
"""

from __future__ import annotations

from sqlmodel import SQLModel


class BaseModel(SQLModel):
    """Application base class. Inherit from this — not ``SQLModel`` — in models."""

    pass
