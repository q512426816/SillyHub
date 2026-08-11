"""change 模块测试 fixture。

自包含建表（不改根 conftest）：``platform_sync`` model 未在根 conftest ``db_engine``
的 import 列表，本 conftest 用 autouse fixture 单独建 ``platform_change_progress`` +
``platform_sync_tokens`` 表，让 change 模块 enrich join 投影测试自包含。

Change 2026-08-11-change-progress-projection task-08 / design §6：enrich_summaries /
enrich_with_workspace_ids 实时 join platform_change_progress 覆盖 current_stage，
根 conftest 未注册该 model → metadata 不含表 → enrich join 抛「表不存在」，故须在此
import 注册 + 单独 create（参照 platform_sync/tests/conftest.py 模式）。
"""

from __future__ import annotations

from typing import Any

import pytest


@pytest.fixture(autouse=True)
async def ensure_platform_change_progress_table(db_engine: Any) -> None:
    """建 ``platform_change_progress`` + ``platform_sync_tokens`` 表。

    platform_sync model 未在根 conftest db_engine import 列表 → metadata 不含该表
    → 根 ``create_all`` 不会建它。此处 import 注册到 metadata + 单独 create 两张表，
    让 change enrich join 投影测试可跑（task-08 acceptance）。
    """
    from app.models.base import BaseModel
    from app.modules.platform_sync import model as _ps_model
    from app.modules.platform_sync import token_model as _ps_token_model

    async with db_engine.begin() as conn:
        await conn.run_sync(
            BaseModel.metadata.create_all,
            tables=[
                _ps_model.PlatformChangeProgressORM.__table__,
                _ps_token_model.PlatformSyncTokenORM.__table__,
            ],
        )
