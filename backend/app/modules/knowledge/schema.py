"""Pydantic DTOs for the knowledge and quicklog APIs."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class KnowledgeEntry(BaseModel):
    """A single knowledge file entry."""

    filename: str
    path: str
    title: str | None = None
    content: str | None = None
    last_modified_at: datetime | None = None


class KnowledgeList(BaseModel):
    items: list[KnowledgeEntry]
    total: int


class QuicklogEntry(BaseModel):
    """A single quicklog file entry."""

    filename: str
    path: str
    title: str | None = None
    content: str | None = None
    last_modified_at: datetime | None = None


class QuicklogList(BaseModel):
    items: list[QuicklogEntry]
    total: int
