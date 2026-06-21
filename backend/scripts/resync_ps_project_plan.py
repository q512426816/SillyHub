"""重新同步 ppm_ps_project_plan.project_id + project_manager_id。

根因（QL ql-20260621-006 + ql-20260621-012）：migrate_ps_project_plan（migrate_from_ruoyi.py:854/857）
project_id 直接 ``str(r["project_id"])``、project_manager_id 用 ``clean_str`` 保留源 Long ID
（均漏用 map_fk），被 ``202607220900`` ALTER 迁移的 uuid 正则过滤丢弃为 NULL →
project_id 18 条 NULL（milestone 责任人裸 UUID）+ project_manager_id 18 条 NULL
（project-plans/milestone 按项目经理 RBAC，NULL 致所有人 readOnly）。

本脚本:构建 maps(project/system_users) → 重读源 ppm_ps_project_plan → 映射 project_id +
project_manager_id → 更新目标库。plan id 用 uuid5_int("ps_project_plan", 源id) 定位，幂等可重跑。

执行（宿主机 backend 目录，读 backend/.env 的 DATABASE_URL）：
    .venv/bin/python scripts/resync_ps_project_plan.py

author: qinyi
created_at: 2026-06-21T15:15:00
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

# 复用 ETL 脚本的源库读取 + 确定性 ID + 脏值判断（同目录 import）
from migrate_from_ruoyi import is_deleted, src_query, uuid5_int
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.modules.ppm.plan.model import PsProjectPlan


def build_project_map() -> dict[Any, uuid.UUID]:
    """源 ppm_project_maintenance.id → 目标 project uuid(uuid5("project", 源id))。"""
    m: dict[Any, uuid.UUID] = {}
    for r in src_query("SELECT id FROM ppm_project_maintenance ORDER BY id"):
        if not is_deleted(r):
            m[str(r["id"])] = uuid5_int("project", r["id"])
    return m


def build_user_map() -> dict[Any, uuid.UUID]:
    """源 system_users.id → 目标 user uuid(uuid5("user", 源id))。"""
    m: dict[Any, uuid.UUID] = {}
    for r in src_query("SELECT id FROM system_users ORDER BY id"):
        m[str(r["id"])] = uuid5_int("user", r["id"])
    return m


def map_uuid(mapping: dict[Any, uuid.UUID], src: Any) -> uuid.UUID | None:
    """源 ID → 目标 UUID；失败返回 None（目标列已是 uuid，不保留源值）。"""
    if src is None:
        return None
    s = str(src).strip()
    if not s or s == "0":
        return None
    return mapping.get(src) or mapping.get(s)


async def main() -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, pool_pre_ping=True, future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    print("==> [1] 构建 maps(project / user)")
    pmap = build_project_map()
    umap = build_user_map()
    print(f"    project={len(pmap)} user={len(umap)}")

    print("==> [2] 重读源 ppm_ps_project_plan")
    rows = src_query(
        "SELECT id, project_id, project_manager_id FROM ppm_ps_project_plan ORDER BY id"
    )
    print(f"    源 plan 数={len(rows)}")

    updates: list[tuple[uuid.UUID, uuid.UUID | None, uuid.UUID | None]] = []
    skipped = 0
    for r in rows:
        if is_deleted(r):
            skipped += 1
            continue
        plan_id = uuid5_int("ps_project_plan", r["id"])
        pid = map_uuid(pmap, r["project_id"])
        mid = map_uuid(umap, r["project_manager_id"])
        updates.append((plan_id, pid, mid))
    pid_unmapped = sum(1 for _, p, _ in updates if p is None)
    mid_unmapped = sum(1 for _, _, m in updates if m is None)
    print(
        f"    待更新={len(updates)} 跳过(已删)={skipped} "
        f"project_id未映射={pid_unmapped} project_manager_id未映射={mid_unmapped}"
    )

    async with factory() as db:
        print("==> [3] 批量更新 project_id + project_manager_id")
        for plan_id, pid, mid in updates:
            plan = await db.get(PsProjectPlan, plan_id)
            if plan is not None:
                if pid is not None:
                    plan.project_id = pid
                if mid is not None:
                    plan.project_manager_id = mid
        await db.commit()

        print("==> [4] 验证")
        all_plans = (await db.execute(select(PsProjectPlan))).scalars().all()
        with_pid = sum(1 for p in all_plans if p.project_id is not None)
        with_mid = sum(1 for p in all_plans if p.project_manager_id is not None)
        print(
            f"    总数={len(all_plans)} "
            f"有project_id={with_pid}(NULL={len(all_plans) - with_pid}) "
            f"有project_manager_id={with_mid}(NULL={len(all_plans) - with_mid})"
        )


if __name__ == "__main__":
    asyncio.run(main())
