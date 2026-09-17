"""knowledge 模块测试隔离（task-07 / 2026-09-17-knowledge-precipitation）。

根 conftest 的 ``_isolate_background_tasks`` autouse fixture 覆盖三处既有
fire-and-forget 任务集（spec_workspace.bootstrap / AgentService /
RunSyncService）；本模块 task-07 新增 ``_BACKGROUND_DISTILL_TASKS``，按同款
模式在此逐测试清理——防后台任务跨测试绑定已关闭的 event loop（'Event loop
is closed' / 静默漏 await）。
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest


@pytest.fixture(autouse=True)
async def _isolate_distill_background_tasks() -> AsyncIterator[None]:
    from app.modules.knowledge.distill import _BACKGROUND_DISTILL_TASKS

    _BACKGROUND_DISTILL_TASKS.clear()
    yield
    pending = [t for t in _BACKGROUND_DISTILL_TASKS if isinstance(t, asyncio.Task)]
    _BACKGROUND_DISTILL_TASKS.clear()
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
